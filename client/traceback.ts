/** A traceback down to the user's code, as Julia's REPL shows it: frames below the first top-level scope
 *  (include_string, the runtime that ran it, Julia's start) are the machinery, not the error's cause. */
export function ours(tb: string): string {
  const lines = tb.trimEnd().split("\n"), top = lines.findIndex((l) => /^\s*\[\d+\] top-level scope\b/.test(l));
  return (top < 0 ? lines : lines.slice(0, top + 2)).join("\n");
}
