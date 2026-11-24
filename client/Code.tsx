// The script editor: CodeMirror 6 with Julia, cells drawn (a rule above each `##` line, the cell at the
// cursor tinted, never a bar beside it), and the run keys: Ctrl Enter the cell, Shift Enter the line or
// selection, F5 the file, Ctrl S save. ponytail: a small editor until @paperboatlab/ui's code editor
// (being ported from paperboat-shared-legacy) lands; then this file becomes a few lines around it.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { cellAt, isHead } from "./cells.ts";

// quiet, as the mockup: weight for keywords, muted comments and strings, numbers in the accent text
const style = HighlightStyle.define([
  { tag: t.keyword, fontWeight: "600" }, { tag: [t.comment, t.string, t.meta], color: "var(--text-muted)" },
  { tag: [t.number, t.bool, t.atom], color: "var(--accent-text)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", background: "transparent", color: "var(--text)", fontSize: "12.5px" },
  ".cm-content": { fontFamily: "var(--font-mono)", padding: "6px 0 40px", caretColor: "var(--text)" },
  ".cm-scroller": { lineHeight: "22px" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { background: "transparent", border: "0", color: "var(--text-muted)", fontSize: "11px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { background: "color-mix(in srgb, var(--accent) 22%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-line.cell-head": { borderTop: "1px solid var(--line)", color: "var(--text-muted)", fontWeight: "500" },
  ".cm-line.cell-head:first-child": { borderTop: "0" },
  ".cm-line.cell-cur": { background: "color-mix(in srgb, var(--accent) 7%, transparent)" },
});

function cellLines(view: EditorView): DecorationSet {
  const doc = view.state.doc, b = new RangeSetBuilder<Decoration>();
  const at = cellAt(doc.toString(), doc.lineAt(view.state.selection.main.head).number);
  const many = doc.toString().split("\n").some(isHead);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      const c = isHead(line.text) ? "cell-head" : "";
      const inCur = many && at && line.number >= at.cell.from && line.number <= at.cell.to;
      if (c || inCur) b.add(line.from, line.from, Decoration.line({ class: [c, inCur ? "cell-cur" : ""].filter(Boolean).join(" ") }));
      pos = line.to + 1;
    }
  }
  return b.finish();
}
const cellsPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(v: EditorView) { this.decorations = cellLines(v); }
  update(u: ViewUpdate) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = cellLines(u.view); }
}, { decorations: (v) => v.decorations });

export type Runner = { cell: (code: string, line: number) => void; line: (code: string, line: number) => void; file: () => void; save: () => void };

export function Code({ text, readOnly, onChange, onCursor, run }: {
  text: string; readOnly: boolean; onChange: (t: string) => void; onCursor: (line: number, col: number) => void; run: Runner;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onCursor, run });
  cb.current = { onChange, onCursor, run };

  useEffect(() => {
    const keys = keymap.of([
      { key: "Mod-Enter", preventDefault: true, run: (v) => {
        const line = v.state.doc.lineAt(v.state.selection.main.head).number, c = cellAt(v.state.doc.toString(), line);
        if (c) cb.current.run.cell(c.code, c.cell.from);
        return true;
      } },
      { key: "Shift-Enter", preventDefault: true, run: (v) => {
        const s = v.state.selection.main;
        if (!s.empty) { cb.current.run.line(v.state.sliceDoc(s.from, s.to), v.state.doc.lineAt(s.from).number); return true; }
        const l = v.state.doc.lineAt(s.head);
        cb.current.run.line(l.text, l.number);
        if (l.number < v.state.doc.lines) v.dispatch({ selection: { anchor: v.state.doc.line(l.number + 1).from } });   // on to the next line, as a REPL user expects
        return true;
      } },
      { key: "F5", preventDefault: true, run: () => { cb.current.run.file(); return true; } },
      { key: "Mod-s", preventDefault: true, run: () => { cb.current.run.save(); return true; } },
      indentWithTab, ...defaultKeymap, ...historyKeymap,
    ]);
    const ext: Extension[] = [
      lineNumbers(), history(), StreamLanguage.define(julia), syntaxHighlighting(style), theme, cellsPlugin, keys,
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), EditorState.tabSize.of(4),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cb.current.onChange(u.state.doc.toString());
        if (u.docChanged || u.selectionSet) { const h = u.state.selection.main.head, l = u.state.doc.lineAt(h); cb.current.onCursor(l.number, h - l.from + 1); }
      }),
    ];
    const v = new EditorView({ parent: box.current!, state: EditorState.create({ doc: text, extensions: ext }) });
    view.current = v;
    return () => v.destroy();
    // a new view per file and read-only state; outside changes arrive below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // the file changed underneath (another editor, git): take it, unless it is what we typed
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
  }, [text]);

  return <div className="code" ref={box} />;
}
