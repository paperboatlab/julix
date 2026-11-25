// Inline results (the Julix mockup): what each top-level line of a run made, shown as a chip at the
// line's right end. A line assigns names (its chip shows their values), defines a function, or draws
// into a figure. Lines inside a block (indented) are skipped: their names are locals, not the session's.

export type LineResult = { line: number; text: string; names: string[]; fn: boolean; plot: boolean };
/** A line's result from one run, and the run's last figure (a drawing line's chip opens it). */
export type Result = { r: LineResult; run: string; fig?: number };
type Run = { id: string; kind: string; source: string; line: number; code: string; state: string; outputs: { type: string }[] };

/** Per file, what its lines made when they last ran: a finished run replaces its lines' results (a failed one clears them). */
export function applyRun(m: Record<string, Result[]>, r: Run): Record<string, Result[]> {
  if (r.kind === "console" || (r.state !== "done" && r.state !== "failed")) return m;
  const end = r.line + r.code.split("\n").length - 1, fig = (r.outputs.filter((o) => o.type === "figure").at(-1) as { n?: number } | undefined)?.n;
  const kept = (m[r.source] ?? []).filter((e) => e.r.line < r.line || e.r.line > end);
  return { ...m, [r.source]: r.state === "done" ? [...kept, ...resultsOf(r.code, r.line).map((x) => ({ r: x, run: r.id, fig }))] : kept };
}

const ID = String.raw`[\p{L}_][\p{L}\p{N}_!\p{M}′-‷★]*`;
const ASSIGN = new RegExp(String.raw`^(?:(?:const|global)\s+)?\(?\s*(${ID}(?:\s*,\s*${ID})*)\s*\)?\s*(?:\.?[+\-*/^])?=(?![=>])`, "u");
const FN = new RegExp(String.raw`^(?:function\s+${ID}|${ID}\s*\([^=]*\)\s*(?:where\s+[^=]*)?=(?![=>]))`, "u");
const PLOT = /\b(?:Figure|Axis3?|Colorbar|Legend|axislegend|lines|scatter|scatterlines|heatmap|surface|contourf?|barplot|hist|stem|stairs|band|hlines|vlines|text|mesh|wireframe|image|series)!?\s*\(/;
const KEYWORDS = new Set(["for", "while", "if", "elseif", "else", "let", "begin", "try", "catch", "finally", "end", "return", "using", "import", "module", "struct", "macro", "do"]);

/** The results of `code` run from line `first` (1-based). */
export function resultsOf(code: string, first: number): LineResult[] {
  const out: LineResult[] = [];
  let depth = 0;   // inside a multi-line block (function … end, for … end): its lines are the block's
  code.split("\n").forEach((text, i) => {
    const t = text.replace(/#.*$/, "").trimEnd();
    const top = depth === 0 && t.length > 0 && !/^\s/.test(t);
    const head = /^\s*(?:function|for|while|if|let|begin|try|struct|module|macro|quote)\b/.test(t) || /\bdo\s*(?:\w+(?:\s*,\s*\w+)*)?\s*$/.test(t);
    if (top) {
      const word = t.split(/\W/u)[0];
      const fn = FN.test(t) && !(head && !t.startsWith("function"));
      const m = !fn && !KEYWORDS.has(word) ? ASSIGN.exec(t) : null;
      const names = m ? m[1].split(",").map((s) => s.trim()) : [];
      const plot = PLOT.test(t);
      if (fn || names.length || plot) out.push({ line: first + i, text, names, fn, plot });
    }
    if (head && !/\bend\s*$/.test(t)) depth++;
    else if (/^\s*end\b/.test(t)) depth = Math.max(0, depth - 1);
  });
  return out;
}

/** A number as a chip says it: four significant digits, no trailing zeros. */
export const short = (s: string) => {
  const x = Number(s);
  if (s.trim() === "" || !Number.isFinite(x)) return s;
  if (Number.isInteger(x) && Math.abs(x) < 1e6) return String(x);
  return Math.abs(x) >= 1e-3 && Math.abs(x) < 1e6 ? String(Number(x.toPrecision(4))) : x.toExponential(2);
};
