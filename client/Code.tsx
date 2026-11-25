// The script editor: @paperboatlab/ui's Editor (grammar, lint and completion through the Julia session,
// find, themes, settings) with what is Julix's own: cells drawn (a rule above each `##` line, the cell at
// the cursor tinted, never a bar beside it) and the run keys: Ctrl Enter the cell, Shift Enter the line or
// selection, F5 the file, Ctrl S save.
import { Editor, languageFor, type EditorPos, type EditorSettings, type Session } from "@paperboatlab/ui/editor";
import { Prec, RangeSet, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, type DecorationSet, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { useMemo, useRef } from "react";
import { cellAt, isHead } from "./cells.ts";
import { api, type Variable } from "./api.ts";
import { short, type Result } from "./results.ts";

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

// Inline results: a chip at a line's right end, as long as the line reads as it did when it ran.
type Chip = { kind: "text" | "vector" | "matrix" | "figure"; label: string; key: string; name?: string; open?: () => void };
const shortType = (t: string) => t.replace(/\{.*$/, "").replace(/^.*\./, "");
const HEAT = [[27, 16, 48], [122, 93, 180], [246, 211, 139]];   // the mockup's heat chip
const heat = (u: number) => { const k = Math.min(1, Math.max(0, u)) * 2, i = Math.min(1, Math.floor(k)), f = k - i;
  return `rgb(${HEAT[i].map((c, j) => Math.round(c + (HEAT[i + 1][j] - c) * f)).join(",")})`; };

function chipOf(e: Result, vars: Map<string, Variable>, onFigure: (run: string, n: number) => void): Chip | null {
  const key = `${e.run}:${e.r.line}`, figure = e.fig ? { kind: "figure" as const, label: "→ figure", key, open: () => onFigure(e.run, e.fig!) } : null;
  if (e.r.fn) return { kind: "text", label: "function", key };
  const vs = e.r.names.map((n) => vars.get(n));
  if (vs.length && vs.every(Boolean)) {
    if (vs.length > 1) return { kind: "text", label: vs.map((v) => (v!.size === 1 ? short(v!.summary) : shortType(v!.type))).join(", "), key };
    const v = vs[0]!;
    if (/^JulixPlot\./.test(v.type)) return figure ?? { kind: "text", label: shortType(v.type), key };
    if (/^(Vector|Array\{[^,]+, ?1\}|.*Range|LinRange)/.test(v.type) && (v.size ?? 0) > 1) return { kind: "vector", label: `${v.size}`, key, name: v.name };
    if (/^(Matrix|Array\{[^,]+, ?2\})/.test(v.type)) return { kind: "matrix", label: `${v.size}`, key, name: v.name };
    if (v.size === 1 && /^(Float|Int|UInt|Bool|Rational|Irrational|BigFloat|BigInt)/.test(v.type)) return { kind: "text", label: short(v.summary), key };
    if (v.type === "String") return { kind: "text", label: v.summary.length > 24 ? `${v.summary.slice(0, 23)}…` : v.summary, key };
    return { kind: "text", label: shortType(v.type), key };
  }
  return e.r.plot ? figure : null;
}

class ChipWidget extends WidgetType {
  chip: Chip;
  constructor(chip: Chip) { super(); this.chip = chip; }
  eq(o: ChipWidget) { return o.chip.key === this.chip.key && o.chip.label === this.chip.label; }
  toDOM() {
    const c = this.chip, s = document.createElement("span");
    s.className = `res${c.kind === "figure" ? " fig" : ""}`;
    const label = document.createElement("span");
    label.textContent = c.label;
    s.append(label);
    if (c.open) { s.title = "Show the figure"; s.onmousedown = (ev) => { ev.preventDefault(); c.open!(); }; }
    if (c.name && (c.kind === "vector" || c.kind === "matrix")) {
      s.title = `${c.name}: ${c.kind === "vector" ? "the values" : "the matrix"}`;
      api.values(c.name).then((v) => {
        if (v?.kind === "vector" && v.values.length > 1) {
          const xs = v.values.filter((_, i) => i % Math.ceil(v.values.length / 24) === 0).filter(Number.isFinite);
          const lo = Math.min(...xs), hi = Math.max(...xs), d = hi - lo || 1;
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 22 10"); svg.setAttribute("class", "spk");
          const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
          p.setAttribute("points", xs.map((x, i) => `${(i / (xs.length - 1)) * 22},${9.5 - ((x - lo) / d) * 9}`).join(" "));
          svg.append(p); s.prepend(svg);
        } else if (v?.kind === "matrix" && v.rows.length) {
          const rows = v.rows, cols = rows[0].length, cv = document.createElement("canvas");
          cv.width = Math.min(16, cols); cv.height = Math.min(10, rows.length); cv.className = "heat";
          const all = rows.flat().filter(Number.isFinite), lo = Math.min(...all), d = Math.max(...all) - lo || 1, g = cv.getContext("2d")!;
          for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
            g.fillStyle = heat((rows[Math.floor((y * rows.length) / cv.height)][Math.floor((x * cols) / cv.width)] - lo) / d);
            g.fillRect(x, y, 1, 1);
          }
          s.prepend(cv);
          label.textContent = `${rows.length} × ${cols}`;
        }
      }, () => {});
    }
    return s;
  }
  ignoreEvent() { return false; }
}
function chips(results: Result[], vars: Variable[], onFigure: (run: string, n: number) => void) {
  const byName = new Map(vars.map((v) => [v.name, v]));
  return [
    EditorView.decorations.of((view) => {
      const doc = view.state.doc, b = new RangeSetBuilder<Decoration>();
      for (const e of [...results].sort((x, y) => x.r.line - y.r.line)) {
        if (e.r.line > doc.lines || doc.line(e.r.line).text !== e.r.text) continue;
        const chip = chipOf(e, byName, onFigure);
        if (chip) b.add(doc.line(e.r.line).to, doc.line(e.r.line).to, Decoration.widget({ widget: new ChipWidget(chip), side: 1 }));
      }
      return b.finish();
    }),
    EditorView.theme({
      // at the editor's right edge, at its line's height (absolute, no top: it keeps its place in the line)
      ".cm-scroller": { position: "relative" },
      ".res": { position: "absolute", right: "8px", marginTop: "1px", display: "inline-flex", alignItems: "center", gap: "5px", height: "18px", padding: "0 6px",
        borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--surface-raised)", font: "10.5px var(--font-mono)",
        color: "var(--text-muted)", whiteSpace: "nowrap", lineHeight: "16px" },
      ".res.fig": { color: "var(--accent-text)", borderColor: "color-mix(in srgb, var(--accent) 35%, var(--line))", cursor: "pointer" },
      ".res .spk": { width: "22px", height: "10px", stroke: "currentColor", fill: "none", strokeWidth: "1" },
      ".res .heat": { width: "16px", height: "10px", borderRadius: "2px", imageRendering: "pixelated" },
    }),
  ];
}

// The debugger in the editor: breakpoints in a gutter left of the line numbers (the accent; a condition
// rings it, a disabled one is hollow), toggled by a click or F9, a right click its menu (App); the line a debug run waits at, tinted.
export type Breakpoint = { line: number; condition?: string; enabled?: boolean };
class Dot extends GutterMarker {
  cls: string;
  constructor(cls: string) { super(); this.cls = cls; }
  eq(o: Dot) { return o.cls === this.cls; }
  toDOM() { const d = document.createElement("span"); d.className = this.cls; return d; }
}
function debugging(bps: Breakpoint[], stop: number | undefined, toggle: (line: number) => void, menu: (line: number, x: number, y: number) => void) {
  return [
    Prec.high(gutter({
      class: "cm-bps",
      markers: (view) => {
        const doc = view.state.doc, at = (l: number) => doc.line(l).from;   // one marker a line: where it waits, else its breakpoint
        const marks = bps.filter((bp) => bp.line <= doc.lines && bp.line !== stop)
          .map((bp) => new Dot(`bp${bp.enabled === false ? " off" : ""}${bp.condition ? " cond" : ""}`).range(at(bp.line)));
        if (stop && stop <= doc.lines) marks.push(new Dot("at").range(at(stop)));
        return RangeSet.of(marks, true);
      },
      initialSpacer: () => new Dot("bp"),
      domEventHandlers: {
        mousedown: (view, line, e) => { if ((e as MouseEvent).button === 0) toggle(view.state.doc.lineAt(line.from).number); return true; },
        contextmenu: (view, line, e) => { const m = e as MouseEvent; m.preventDefault(); menu(view.state.doc.lineAt(line.from).number, m.clientX, m.clientY); return true; },
      },
    })),
    stop ? EditorView.decorations.of((view) => stop <= view.state.doc.lines
      ? RangeSet.of([Decoration.line({ class: "dbg-at" }).range(view.state.doc.line(stop).from)]) : Decoration.none) : [],
    stop ? ViewPlugin.define((view) => {   // the paused line comes into view
      requestAnimationFrame(() => stop <= view.state.doc.lines && view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(stop).from, { y: "center" }) }));
      return {};
    }) : [],
    EditorView.theme({
      ".cm-bps": { width: "16px", cursor: "pointer" },
      ".cm-bps .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center" },
      ".cm-bps .bp": { width: "9px", height: "9px", borderRadius: "50%", background: "var(--accent)" },
      ".cm-bps .bp.cond": { boxShadow: "0 0 0 2px var(--surface-raised), 0 0 0 3px var(--accent)" },
      ".cm-bps .bp.off": { background: "transparent", border: "1.5px solid var(--accent)" },
      ".cm-bps .cm-gutterElement:first-child .bp": { visibility: "hidden" },   // the spacer
      ".cm-bps .at": { width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "8px solid var(--accent)", marginLeft: "-6px" },
      ".cm-line.dbg-at": { background: "color-mix(in srgb, var(--accent) 22%, transparent)" },
    }),
  ];
}

export type Runner = { cell: (code: string, line: number) => void; line: (code: string, line: number) => void; file: () => void; save: () => void };

/** One file per mount: the caller remounts (`key`) for another file or a copy changed on disk. */
export function Code({ path, text, readOnly, onChange, onPos, run, busy, results, variables, onFigure, breakpoints, onBreakpoint, onBreakpointMenu, stopAt, session, settings, appTheme }: {
  path: string; text: string; readOnly: boolean; onChange: (t: string) => void; onPos: (p: EditorPos) => void; run: Runner;
  /** The lines a run of this file is running now. */
  busy?: { from: number; to: number };
  /** What this file's lines made when they last ran, and the session's variables to read them from. */
  results?: Result[]; variables?: Variable[]; onFigure?: (run: string, n: number) => void;
  /** This file's breakpoints, F9 or a gutter click toggling one, a right click on the gutter, and the line a debug run waits at. */
  breakpoints?: Breakpoint[]; onBreakpoint?: (line: number) => void; onBreakpointMenu?: (line: number, x: number, y: number) => void; stopAt?: number;
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
    { key: "F9", preventDefault: true, run: (v) => { bp.current?.(v.state.doc.lineAt(v.state.selection.main.head).number); return true; } },
    { key: "Mod-s", preventDefault: true, run: () => { r.current.save(); return true; } },
  ], []);
  const language = useMemo(() => languageFor(path), [path]);
  const fig = useRef(onFigure), bp = useRef(onBreakpoint), bpMenu = useRef(onBreakpointMenu);
  fig.current = onFigure;
  bp.current = onBreakpoint;
  bpMenu.current = onBreakpointMenu;
  const extra = useMemo(() => language.id === "julia"
    ? [cells, busy ? running(busy) : [], results?.length ? chips(results, variables ?? [], (r, n) => fig.current?.(r, n)) : [],
      debugging(breakpoints ?? [], stopAt, (l) => bp.current?.(l), (l, x, y) => bpMenu.current?.(l, x, y))] : undefined,
  [language, busy?.from, busy?.to, results, variables, breakpoints, stopAt]);
  return (
    <Editor value={text} onChange={onChange} onPos={onPos} language={language} session={language.runtime === "julia" ? session : undefined}
      settings={settings} appTheme={appTheme} ariaLabel={path} keys={keys} extra={extra} readOnly={readOnly} />
  );
}
