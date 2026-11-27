// The app server's API (server/main.ts), typed for the page.
import type { Example } from "@paperboatlab/ui";
import type { Session } from "@paperboatlab/ui/editor";
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
  debug?: boolean;
};
export type Values = { kind: "scalar"; value: number } | { kind: "vector"; values: number[] } | { kind: "matrix"; rows: number[][] };
/** A hub Malachite knows (server/hubs.ts, from `paperboat hub list`). */
export type HubInfo = { id: string; name: string; path: string; shown: string; place: "local" | "google-drive" | "onedrive" | "dropbox" | "icloud"; missing?: boolean; conflicts?: number; holds?: string };
/** What Julix works in (server/main.ts): a folder, a hub, or null (the Start page). */
export type Workspace = { kind: "folder" | "hub"; root: string; name: string; hub?: string };
export type Theme = "light" | "dark" | "system";
export type Scale = 0.75 | 1 | 1.25;
export type RecentEntry = { kind: "folder" | "hub" | "file"; path: string; hub?: string; app?: string; at: number };
export type Variable = { name: string; type: string; summary: string; size?: number };
export type Breakpoint = { line: number; condition?: string; enabled?: boolean };
/** Where a debug run waits (paperboat docs/runtime.md "Debugging"): frames innermost first, the top one's locals. */
export type Paused = { run: string; source: string; reason: string; line: number; frames: { id: number; name: string; line: number }[]; locals: Variable[] };
export type DebugCommand = "continue" | "over" | "into" | "out" | "pause" | "stop";
export type Figure = { run: string; n: number; mime: string; source: string; kind: Kind; time: string; thumb?: boolean };
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
  paperboat: () => call<{ version: string | null }>("GET", "/api/paperboat"),
  workspace: () => call<{ workspace: Workspace | null; home: string; version: string; session: "stopped" | "starting" | "running" }>("GET", "/api/workspace"),
  /** Work in a folder (a whole path) or a hub (its id); null: Close, back to Start. */
  workIn: (to: { kind: "folder"; path: string } | { kind: "hub"; id: string } | { kind: null }) => call<Workspace | null>("POST", "/api/workspace", to),
  /** A file by its whole path: from outside the workspace, the workspace switches to its folder or hub. */
  openPath: (path: string) => call<{ workspace: Workspace; path: string }>("POST", "/api/open", { path }),
  /** Writes a file by its whole path, then opens it as openPath does; `fresh`: never over a file that is there. */
  saveAs: (path: string, text: string, fresh = false) => call<{ workspace: Workspace; path: string }>("POST", "/api/saveas", { path, text, new: fresh }),
  recent: () => call<{ version: 1; recent: RecentEntry[] }>("GET", "/api/recent"),
  /** A file of the workspace opened: first in recent.json. */
  opened: (path: string) => call("POST", "/api/recent", { path }),
  clearRecent: () => call("POST", "/api/recent/clear", {}),
  settings: () => call<{ theme: Theme; scale: Scale }>("GET", "/api/settings"),
  setTheme: (theme: Theme) => call("PUT", "/api/settings", { theme }),
  setScale: (scale: Scale) => call("PUT", "/api/settings", { scale }),
  hubs: () => call<HubInfo[]>("GET", "/api/hubs"),
  hubNew: (name: string) => call<Workspace>("POST", "/api/hubs/new", { name }),
  hubInMalachite: (id: string) => call("POST", "/api/hubs/malachite", { id }),
  /** Manage runtimes…: the Paperboat Launcher on Runtimes › julia. */
  manageRuntimes: () => call("POST", "/api/launcher", {}),
  /** The examples for Ctrl K (`paperboat example list`); [] without Paperboat. */
  examples: () => call<Example[]>("GET", "/api/examples"),
  /** Open example: the CLI opens it where it is, in a new window with the example banner; its Copy goes to this folder. */
  openExample: (id: string) => call("POST", "/api/examples/open", { id }),
  /** The example banner's Copy: into `to`, the copy opened in a new window. */
  copyExample: (id: string, to: string) => call<{ path: string }>("POST", "/api/examples/copy", { id, to }),
  tree: () => call<{ files: Entry[] }>("GET", "/api/tree"),
  file: (p: string) => call<{ path: string; text: string }>("GET", `/api/file?path=${q(p)}`),
  save: (p: string, text: string) => call("PUT", `/api/file?path=${q(p)}`, { text }),
  create: (p: string, text = "") => call<{ path: string }>("POST", "/api/new", { path: p, text }),
  mkdir: (p: string) => call("POST", "/api/mkdir", { path: p }),
  move: (from: string, to: string) => call("POST", "/api/move", { from, to }),
  copy: (from: string, to: string) => call<{ path: string }>("POST", "/api/copy", { from, to }),
  trash: (p: string) => call("POST", "/api/trash", { path: p }),
  reveal: (p: string) => call("POST", "/api/reveal", { path: p }),
  run: (kind: Kind, args: { path?: string; code?: string; line?: number; debug?: boolean; breakpoints?: Breakpoint[] }) => call<Run>("POST", "/api/run", { kind, ...args }),
  paused: () => call<{ paused: Paused | null }>("GET", "/api/debug"),
  debug: (command: DebugCommand) => call<{ running: boolean }>("POST", "/api/debug", { command }),
  setBreakpoints: (file: string, breakpoints: Breakpoint[]) => call("POST", "/api/debug", { command: "breakpoints", file, breakpoints }),
  frameLocals: (frame: number) => call<{ locals: Variable[] }>("POST", "/api/debug", { command: "locals", frame }),
  evalIn: (frame: number, code: string) => call<{ type: string; summary: string }>("POST", "/api/debug", { command: "eval", frame, code }),
  interrupt: () => call("POST", "/api/interrupt", {}),
  restart: () => call("POST", "/api/restart", {}),
  variables: () => call<Variable[]>("GET", "/api/variables"),
  runs: () => call<Run[]>("GET", "/api/runs"),
  values: (name: string) => call<Values | null>("GET", `/api/values?name=${q(name)}`),
  setValues: (name: string, value: number | number[] | number[][]) => call("PUT", "/api/values", { name, value }),
  helpItems: (query: string) => call<{ id: string; title: string; kind: string; summary: string }[]>("GET", `/api/help?q=${q(query)}`),
  helpPage: (id: string) => call<{ html: string }>("GET", `/api/help/page?id=${q(id)}`),
  figures: () => call<Figure[]>("GET", "/api/figures"),
  saveThumb: (run: string, n: number, png: string) => call("POST", "/api/figure/thumb", { run, n, png }),
  removeFigures: (run: string) => call("POST", "/api/figures/remove", { run }),
  runtimes: () => call<Peek>("GET", "/api/runtimes"),
  figure: (f: { run: string; n: number }) => `/api/figure?run=${q(f.run)}&n=${f.n}`,
  thumb: (f: { run: string; n: number }) => `/api/figure?run=${q(f.run)}&n=${f.n}&thumb`,
};

/** Server-Sent Events: files, runs, variables, the session. Reconnects by itself (EventSource does). */
export function listen(on: (e: any) => void): () => void {
  const es = new EventSource("/events");
  es.onmessage = (m) => { try { on(JSON.parse(m.data)); } catch { /* not ours */ } };
  return () => es.close();
}

/** The Julia session as the kit's editor and languages speak to it (paperboat-runtime/0 `lint`, `complete`),
 *  through the server. Pass it only while a session runs: without one the server has no answer. */
export const session: Session = {
  request: async (op, args) => {
    const r = await call<{ result: unknown }>("POST", "/api/session", { op, args });
    if (r.result === null) throw new Error("no Julia session yet");
    return r.result;
  },
};
