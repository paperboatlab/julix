// Code runs in one Julia session lease for the workspace (paperboat-runtime/0 session mode: a live
// namespace, as a REPL is). Julix runs no code itself: it asks paperboatd for the lease and speaks the
// protocol. A run is a file, a cell, a line or an expression; what it displays as an image becomes a
// figure, kept in `.julix/figures/<run>/` with the run's record beside it.
import fs from "node:fs";
import path from "node:path";
import { Control, type Lease } from "./control.ts";
import { Folder } from "./folder.ts";
import { Runtime, RuntimeError } from "./runtime.ts";

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
type Session = { lease: Lease; rt: Runtime; cwd?: string };

const INTERRUPT_GRACE_MS = 3000;   // after an interrupt with no reply, the session restarts (paperboat docs/runtime.md)
const IMAGES = ["image/svg+xml", "image/png"] as const;
const EXT: Record<string, string> = { "image/svg+xml": "svg", "image/png": "png" };
const OWNER = (f: Folder) => `julix:${f.root}`;

/** Code from line `line` (1-based) keeps its line numbers in tracebacks: the lines above become blank. */
export const atLine = (code: string, line: number) => "\n".repeat(Math.max(0, line - 1)) + code;

/** The folder a run's code starts in: its file's folder in the workspace (the lease mounts the workspace). */
function chdir(dir: string): string {
  return `cd(joinpath(ENV["PAPERBOAT_PROJECT"], ${JSON.stringify(dir).replaceAll("$", "\\$")})); nothing`;
}

let seq = 0;
const runId = () => `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-${(++seq).toString().padStart(3, "0")}`;

export class Sessions {
  private session?: Promise<Session>;
  private queue: Promise<unknown> = Promise.resolve();
  running?: Run;
  /** This session's runs, newest last (the console after a page reload); a new session starts empty. */
  runs: Run[] = [];
  variables: Variable[] = [];

  private folder: Folder;
  private control: Control;
  private emit: (e: Record<string, unknown>) => void;

  constructor(folder: Folder, control: Control, emit: (e: Record<string, unknown>) => void) {
    this.folder = folder;
    this.control = control;
    this.emit = emit;
    control.onEvent = (e) => {
      this.emit({ type: "runtime", event: e });
      if ((e.event === "runtime.exited" || e.event === "runtime.failed") && this.session)
        this.session.then((s) => { if (s.lease.id === e.lease || s.lease.id === (e as any).id) this.drop(); }, () => {});
    };
    control.onClose = () => this.drop();
  }

  private open(): Promise<Session> {
    this.session ??= (async () => {
      this.emit({ type: "session", state: "starting" });
      const lease = await this.control.call<Lease>("acquire", { runtime: "julia", mode: "session", project: this.folder.root, owner: OWNER(this.folder) });
      if (lease.state === "failed") throw new Error(lease.error ?? "Julia failed to start");
      const rt = await Runtime.connect(path.join(lease.ipc, "runtime.sock"), 120_000);
      rt.onClose = () => this.drop();
      this.emit({ type: "session", state: "running" });
      return { lease, rt };
    })();
    this.session.catch(() => { this.session = undefined; this.emit({ type: "session", state: "stopped" }); });
    return this.session;
  }

  private drop() {
    const p = this.session;
    this.session = undefined;
    this.variables = [];
    this.runs = [];
    p?.then((s) => { s.rt.close(); this.control.call("release", { lease: s.lease.id }).catch(() => {}); }, () => {});
    this.emit({ type: "session", state: "stopped" });
    this.emit({ type: "variables", variables: [] });
  }

  figuresDir(run?: string) { return path.join(this.folder.root, ".julix", "figures", ...(run ? [run] : [])); }

  /** Runs `code` from `source` (a workspace path, or "console") at `line`; runs go one after another. */
  run(kind: Kind, source: string, code: string, line = 1): Run {
    const run: Run = { id: runId(), kind, source, line, code, state: "queued", outputs: [] };
    this.runs = [...this.runs.slice(-299), run];
    const send = () => this.emit({ type: "run", run });
    send();
    let figures = 0;
    const figure = (data: Record<string, string>) => {
      const mime = IMAGES.find((m) => data[m]);
      if (!mime) return false;
      const n = ++figures, dir = this.figuresDir(run.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${n}.${EXT[mime]}`), mime === "image/png" ? Buffer.from(data[mime], "base64") : data[mime]);
      run.outputs.push({ type: "figure", n, mime });
      return true;
    };
    this.queue = this.queue.then(async () => {
      run.state = "running";
      run.started = new Date().toISOString();
      this.running = run;
      send();
      const t0 = Date.now();
      let state: "done" | "failed";
      try {
        const s = await this.open();
        const dir = source === "console" || Folder.readOnly(source) ? "" : path.posix.dirname(source) === "." ? "" : path.posix.dirname(source);
        if (s.cwd !== dir) { await s.rt.request("eval", { code: chdir(dir), cell: "julix: the script's folder" }); s.cwd = dir; }
        run.runtime = { name: s.rt.hello!.runtime.name, version: s.rt.hello!.runtime.version, backend: s.lease.backend };
        const label = source === "console" ? "console" : source.replace(/^@examples\//, "examples/");
        const result = await s.rt.request<{ data: Record<string, string> | null }>("eval", { code: atLine(code, line), cell: label }, (note) => {
          if (note.type === "stream") {
            const last = run.outputs.at(-1);
            if (last?.type === "stream" && last.name === note.name) last.text += note.text;
            else run.outputs.push({ type: "stream", name: note.name, text: note.text });
          } else if (note.type === "display" && !figure(note.data)) run.outputs.push({ type: "result", data: note.data });
          send();
        });
        if (result?.data && !figure(result.data)) run.outputs.push({ type: "result", data: result.data });
        state = "done";
      } catch (e) {
        run.outputs.push({ type: "error", error: e instanceof RuntimeError ? e.error : { type: "julix", message: String((e as Error).message ?? e) } });
        state = "failed";
      }
      run.ms = Date.now() - t0;
      await this.refreshVariables();   // before "done", so a finished run never shows the variables before it
      run.state = state;
      if (figures) fs.writeFileSync(path.join(this.figuresDir(run.id), "run.json"), JSON.stringify({ ...run, outputs: undefined }));
      if (this.running === run) this.running = undefined;
      send();
    });
    return run;
  }

  /** The session's variables, asked after every run (and sent to the page). */
  async refreshVariables() {
    const s = await this.session?.catch(() => undefined);
    if (!s) return;
    try { this.variables = await s.rt.request<Variable[]>("variables"); } catch { return; }
    this.variables.sort((a, b) => a.name.localeCompare(b.name));
    this.emit({ type: "variables", variables: this.variables });
  }

  /** Completions at `pos` (a character offset in `code`); none when no session is up yet. */
  async complete(code: string, pos: number): Promise<{ matches: string[]; start: number; end: number }> {
    const s = await this.session?.catch(() => undefined);
    if (!s) return { matches: [], start: pos, end: pos };
    const byte = Buffer.byteLength(code.slice(0, pos));   // the runtime counts bytes; the page counts characters
    const r = await s.rt.request<{ matches: string[]; start: number; end: number }>("complete", { code, pos: byte });
    const chars = (b: number) => Buffer.from(code).subarray(0, b).toString().length;
    return { matches: r.matches, start: chars(r.start), end: chars(r.end) };
  }

  /** Every figure kept, newest run first. */
  figures(): Figure[] {
    const root = this.figuresDir();
    if (!fs.existsSync(root)) return [];
    const out: Figure[] = [];
    for (const id of fs.readdirSync(root).sort().reverse()) {
      let meta: Run;
      try { meta = JSON.parse(fs.readFileSync(path.join(root, id, "run.json"), "utf8")); } catch { continue; }   // a run still writing, or damaged
      for (const f of fs.readdirSync(path.join(root, id))) {
        const m = /^(\d+)\.(svg|png)$/.exec(f);
        if (m) out.push({ run: id, n: Number(m[1]), mime: m[2] === "svg" ? "image/svg+xml" : "image/png", source: meta.source, kind: meta.kind, time: meta.started ?? "" });
      }
    }
    return out.sort((a, b) => (a.run === b.run ? a.n - b.n : a.run < b.run ? 1 : -1));
  }

  figureFile(run: string, n: number): string {
    if (!/^[\w-]+$/.test(run)) throw new Error("bad run");
    for (const ext of ["svg", "png"]) { const p = path.join(this.figuresDir(run), `${n}.${ext}`); if (fs.existsSync(p)) return p; }
    throw new Error("no such figure");
  }

  removeFigures(run: string) { if (/^[\w-]+$/.test(run)) fs.rmSync(this.figuresDir(run), { recursive: true, force: true }); }

  /** Stops the running code: SIGINT through the daemon; a runtime that doesn't answer soon restarts. */
  async interrupt() {
    const run = this.running;
    if (!this.session || !run) return { interrupted: false };
    const s = await this.session;
    await this.control.call("interrupt", { lease: s.lease.id }).catch(() => s.rt.request("interrupt").catch(() => {}));
    setTimeout(() => { if (this.running === run) this.restart(); }, INTERRUPT_GRACE_MS);
    return { interrupted: true };
  }

  /** A fresh session: the variables are lost; the next run starts a new one. */
  restart() { this.drop(); return {}; }

  close() { this.drop(); this.control.close(); }

  /** The runtimes key's peek: this workspace's session with its stats. */
  async peek() {
    const leases = await this.control.call<Lease[]>("ps");
    const mine = leases.filter((l) => l.owner === OWNER(this.folder));
    const sessions = await Promise.all(mine.map(async (l) => ({
      ...l,
      stats: await this.control.call("stats", { lease: l.id }).then((r: any) => r.stats, () => null),
      running: this.running ? { source: this.running.source, kind: this.running.kind, line: this.running.line, since: this.running.started } : null,
    })));
    const list = await this.control.call<{ runtimes: { name: string; version: string; modes: string[] }[] }>("runtimes.list");
    return { sessions, julia: list.runtimes.find((r) => r.name === "julia" && r.modes.includes("session")) ?? null };
  }
}
