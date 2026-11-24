// The script editor: @paperboatlab/ui's Editor (grammar, lint and completion through the Julia session,
// find, themes, settings) with what is Julix's own: cells drawn (a rule above each `##` line, the cell at
// the cursor tinted, never a bar beside it) and the run keys: Ctrl Enter the cell, Shift Enter the line or
// selection, F5 the file, Ctrl S save.
import { Editor, languageFor, type EditorPos, type EditorSettings, type Session } from "@paperboatlab/ui/editor";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type KeyBinding, type ViewUpdate } from "@codemirror/view";
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

export type Runner = { cell: (code: string, line: number) => void; line: (code: string, line: number) => void; file: () => void; save: () => void };

/** One file per mount: the caller remounts (`key`) for another file or a copy changed on disk. */
export function Code({ path, text, readOnly, onChange, onPos, run, session, settings, appTheme }: {
  path: string; text: string; readOnly: boolean; onChange: (t: string) => void; onPos: (p: EditorPos) => void; run: Runner;
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
  return (
    <Editor value={text} onChange={onChange} onPos={onPos} language={language} session={language.runtime === "julia" ? session : undefined}
      settings={settings} appTheme={appTheme} ariaLabel={path} keys={keys} extra={language.id === "julia" ? cells : undefined} readOnly={readOnly} />
  );
}
