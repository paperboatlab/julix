// The script editor: @paperboatlab/ui's Editor (grammar, lint and completion through the Julia session,
// find, themes, settings) with what is Julix's own: cells drawn (a rule above each `##` line, the cell at
// the cursor tinted, never a bar beside it) and the run keys: Ctrl Enter the cell, Shift Enter the line or
// selection, F5 the file, Ctrl S save.
import { Editor, languageFor, type EditorPos, type EditorSettings, type Session } from "@paperboatlab/ui/editor";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { useMemo, useRef } from "react";
import { cellAt, isHead } from "./cells.ts";

function cellLines(view: EditorView): DecorationSet {
  const doc = view.state.doc, text = doc.toString(), b = new RangeSetBuilder<Decoration>();
  const at = text.split("\n").some(isHead) ? cellAt(text, doc.lineAt(view.state.selection.main.head).number) : null;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      const cls = [isHead(line.text) && "cell-head", at && line.number >= at.cell.from && line.number <= at.cell.to && "cell-cur"].filter(Boolean).join(" ");
      if (cls) b.add(line.from, line.from, Decoration.line({ class: cls }));
      pos = line.to + 1;
    }
  }
  return b.finish();
}
const cells = [
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(v: EditorView) { this.decorations = cellLines(v); }
    update(u: ViewUpdate) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = cellLines(u.view); }
  }, { decorations: (v) => v.decorations }),
  EditorView.theme({
    ".cm-line.cell-head": { borderTop: "1px solid var(--line)", fontWeight: "500" },
    ".cm-line.cell-cur": { background: "color-mix(in srgb, var(--accent) 7%, transparent)" },
  }),
];

// The running block (REBRAND: its outline and the spinner, no progress bar): the lines a run took.
class SpinnerWidget extends WidgetType {
  toDOM() {
    const s = document.createElement("span");
    s.className = "spinner run-spin";
    s.style.setProperty("--s", "12px");
    s.setAttribute("role", "status");
    s.setAttribute("aria-label", "Running");
    s.innerHTML = "<i><b></b><em></em><em></em><em></em><em></em></i>";
    return s;
  }
}
function running(busy: { from: number; to: number }) {
  return [
    EditorView.decorations.of((view) => {
      const doc = view.state.doc, b = new RangeSetBuilder<Decoration>();
      const from = Math.min(busy.from, doc.lines), to = Math.min(busy.to, doc.lines);
      for (let n = from; n <= to; n++) {
        const line = doc.line(n);
        b.add(line.from, line.from, Decoration.line({ class: ["run-on", n === from && "run-first", n === to && "run-last"].filter(Boolean).join(" ") }));
        if (n === from) b.add(line.to, line.to, Decoration.widget({ widget: new SpinnerWidget(), side: 1 }));
      }
      return b.finish();
    }),
    EditorView.theme({
      ".cm-line.run-on": { boxShadow: "inset 1px 0 var(--accent), inset -1px 0 var(--accent)" },
      ".cm-line.run-on.run-first": { boxShadow: "inset 1px 0 var(--accent), inset -1px 0 var(--accent), inset 0 1px var(--accent)", borderTopLeftRadius: "4px", borderTopRightRadius: "4px" },
      ".cm-line.run-on.run-last": { boxShadow: "inset 1px 0 var(--accent), inset -1px 0 var(--accent), inset 0 -1px var(--accent)", borderBottomLeftRadius: "4px", borderBottomRightRadius: "4px" },
      ".cm-line.run-on.run-first.run-last": { boxShadow: "inset 0 0 0 1px var(--accent)" },
      ".run-spin": { marginLeft: "10px", verticalAlign: "-2px" },
    }),
  ];
}

export type Runner = { cell: (code: string, line: number) => void; line: (code: string, line: number) => void; file: () => void; save: () => void };

/** One file per mount: the caller remounts (`key`) for another file or a copy changed on disk. */
export function Code({ path, text, readOnly, onChange, onPos, run, busy, session, settings, appTheme }: {
  path: string; text: string; readOnly: boolean; onChange: (t: string) => void; onPos: (p: EditorPos) => void; run: Runner;
  /** The lines a run of this file is running now. */
  busy?: { from: number; to: number };
  session?: Session; settings: EditorSettings; appTheme: "light" | "dark";
}) {
  const r = useRef(run);
  r.current = run;
  const keys = useMemo<KeyBinding[]>(() => [
    { key: "Mod-Enter", preventDefault: true, run: (v) => {
      const c = cellAt(v.state.doc.toString(), v.state.doc.lineAt(v.state.selection.main.head).number);
      if (c) r.current.cell(c.code, c.cell.from);
      return true;
    } },
    { key: "Shift-Enter", preventDefault: true, run: (v) => {
      const s = v.state.selection.main;
      if (!s.empty) { r.current.line(v.state.sliceDoc(s.from, s.to), v.state.doc.lineAt(s.from).number); return true; }
      const l = v.state.doc.lineAt(s.head);
      r.current.line(l.text, l.number);
      if (l.number < v.state.doc.lines) v.dispatch({ selection: { anchor: v.state.doc.line(l.number + 1).from } });   // on to the next line, as a REPL user expects
      return true;
    } },
    { key: "F5", preventDefault: true, run: () => { r.current.file(); return true; } },
    { key: "Mod-s", preventDefault: true, run: () => { r.current.save(); return true; } },
  ], []);
  const language = useMemo(() => languageFor(path), [path]);
  const extra = useMemo(() => language.id === "julia" ? [cells, busy ? running(busy) : []] : undefined, [language, busy?.from, busy?.to]);
  return (
    <Editor value={text} onChange={onChange} onPos={onPos} language={language} session={language.runtime === "julia" ? session : undefined}
      settings={settings} appTheme={appTheme} ariaLabel={path} keys={keys} extra={extra} readOnly={readOnly} />
  );
}
