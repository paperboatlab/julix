// Cells: a line that starts with `##` opens one (as legacy MX and the Julia VS Code extension do); it
// runs to the line before the next `##`, or the end. Lines before the first `##` are a cell too.
// Lines are 1-based, as the editor and Julia's tracebacks count them.

export type Cell = { from: number; to: number; title: string };

export const isHead = (line: string) => /^##(\s|$)/.test(line);
/** Whether lines `from`…`to` hold code: a line that isn't blank or a head (`line(n)`: line n's text). */
const holds = (line: (n: number) => string, from: number, to: number) => {
  for (let n = from; n <= to; n++) { const l = line(n); if (l.trim() && !isHead(l)) return true; }
  return false;
};

export function cells(text: string): Cell[] {
  const lines = text.split("\n"), out: Cell[] = [];
  let from = 1, title = "";
  lines.forEach((l, i) => {
    if (!isHead(l) || i === 0) { if (i === 0 && isHead(l)) title = l.slice(2).trim(); return; }
    out.push({ from, to: i, title });
    from = i + 1;
    title = l.slice(2).trim();
  });
  out.push({ from, to: lines.length, title });
  const line = (n: number) => lines[n - 1];
  return out.filter((c) => c.title || holds(line, c.from, c.to));
}

/** The cell holding `line`, and its code. */
export function cellAt(text: string, line: number): { cell: Cell; index: number; code: string } | null {
  const all = cells(text), index = all.findIndex((c) => line >= c.from && line <= c.to);
  if (index < 0) return null;
  const cell = all[index];
  return { cell, index, code: text.split("\n").slice(cell.from - 1, cell.to).join("\n") };
}

/** The cell holding `at` (as cellAt's), read line by line (`line(n)`, `count` lines) from `at` out to its heads, not
 *  the whole text: the editor asks on every key. Null when the text has no `##` line, as for a cell cellAt drops. */
export function cellAround(line: (n: number) => string, count: number, at: number): Cell | null {
  let from = at, to = at;
  while (from > 1 && !isHead(line(from))) from--;
  while (to < count && !isHead(line(to + 1))) to++;
  if (from === 1 && to === count && !isHead(line(1))) return null;   // no head anywhere: no cells to draw
  const title = isHead(line(from)) ? line(from).slice(2).trim() : "";
  return title || holds(line, from, to) ? { from, to, title } : null;
}
