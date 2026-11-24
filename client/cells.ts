// Cells: a line that starts with `##` opens one (as legacy MX and the Julia VS Code extension do); it
// runs to the line before the next `##`, or the end. Lines before the first `##` are a cell too.
// Lines are 1-based, as the editor and Julia's tracebacks count them.

export type Cell = { from: number; to: number; title: string };

export const isHead = (line: string) => /^##(\s|$)/.test(line);

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
  return out.filter((c) => lines.slice(c.from - 1, c.to).some((l) => l.trim() && !isHead(l)) || c.title);
}

/** The cell holding `line`, and its code. */
export function cellAt(text: string, line: number): { cell: Cell; index: number; code: string } | null {
  const all = cells(text), index = all.findIndex((c) => line >= c.from && line <= c.to);
  if (index < 0) return null;
  const cell = all[index];
  return { cell, index, code: text.split("\n").slice(cell.from - 1, cell.to).join("\n") };
}
