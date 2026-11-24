// The app server's API (server/main.ts), typed for the page.
export type Entry = { path: string; name: string; kind: "dir" | "file"; size?: number; mtime?: number; children?: Entry[] };
export type Kind = "file" | "cell" | "line" | "console";
export type Output =
  | { type: "stream"; name: string; text: string }
  | { type: "result"; data: Record<string, string> }
  | { type: "figure"; n: number; mime: string }
  | { type: "error"; error: { type?: string; message: string; traceback?: string } };
export type Run = {
  id: string; kind: Kind; source: string; line: number; code: string;
  state: "queued" | "running" | "done" | "failed"; started?: string; ms?: number; outputs: Output[];
  runtime?: { name: string; version: string; backend: string };
};
export type Variable = { name: string; type: string; summary: string; size?: number };
export type Figure = { run: string; n: number; mime: string; source: string; kind: Kind; time: string };
export type Peek = {
  sessions: { id: string; backend: string; state: string; uptime_s?: number; idle_s?: number; stats: { cpu_percent: number; memory_bytes: number } | null;
    running: { source: string; kind: Kind; line: number; since?: string } | null }[];
  julia: { name: string; version: string } | null;
};

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}
const q = encodeURIComponent;

export const api = {
  folder: () => call<{ name: string; root: string; version: string }>("GET", "/api/folder"),
  tree: () => call<{ files: Entry[]; examples: Entry[] }>("GET", "/api/tree"),
  file: (p: string) => call<{ path: string; text: string; readOnly: boolean }>("GET", `/api/file?path=${q(p)}`),
  save: (p: string, text: string) => call("PUT", `/api/file?path=${q(p)}`, { text }),
  create: (p: string, text = "") => call<{ path: string }>("POST", "/api/new", { path: p, text }),
  mkdir: (p: string) => call("POST", "/api/mkdir", { path: p }),
  move: (from: string, to: string) => call("POST", "/api/move", { from, to }),
  copy: (from: string, to: string) => call<{ path: string }>("POST", "/api/copy", { from, to }),
  trash: (p: string) => call("POST", "/api/trash", { path: p }),
  reveal: (p: string) => call("POST", "/api/reveal", { path: p }),
  run: (kind: Kind, args: { path?: string; code?: string; line?: number }) => call<Run>("POST", "/api/run", { kind, ...args }),
  interrupt: () => call("POST", "/api/interrupt", {}),
  restart: () => call("POST", "/api/restart", {}),
  variables: () => call<Variable[]>("GET", "/api/variables"),
  runs: () => call<Run[]>("GET", "/api/runs"),
  complete: (code: string, pos: number) => call<{ matches: string[]; start: number; end: number }>("POST", "/api/complete", { code, pos }),
  figures: () => call<Figure[]>("GET", "/api/figures"),
  removeFigures: (run: string) => call("POST", "/api/figures/remove", { run }),
  runtimes: () => call<Peek>("GET", "/api/runtimes"),
  figure: (f: { run: string; n: number }) => `/api/figure?run=${q(f.run)}&n=${f.n}`,
};

/** Server-Sent Events: files, runs, variables, the session. Reconnects by itself (EventSource does). */
export function listen(on: (e: any) => void): () => void {
  const es = new EventSource("/events");
  es.onmessage = (m) => { try { on(JSON.parse(m.data)); } catch { /* not ours */ } };
  return () => es.close();
}
