// Code runs in one Julia session lease for the workspace (paperboat-runtime/0 session mode: a live
// namespace, as a REPL is). Julix runs no code itself: it asks paperboatd for the lease and speaks the
// protocol. A run is a file, a cell, a line or an expression; what it displays as an image becomes a
// figure, kept in `.julix/figures/<run>/` with the run's record beside it.
import fs from "node:fs";
import path from "node:path";
import { Control, type Lease } from "./control.ts";
import { Folder } from "./folder.ts";
import { Runtime, RuntimeError } from "./runtime.ts";
import { hasJulixPlot, packages } from "./packages.ts";

export type Kind = "file" | "cell" | "line" | "console";
/** A breakpoint in a file (paperboat docs/runtime.md "Debugging"): a line, and Julia code that must be true. */
export type Breakpoint = { line: number; condition?: string; enabled?: boolean };
/** Where a debug run waits: what the runtime said when it stopped (frames innermost first, the top one's locals). */
export type Paused = { run: string; source: string; reason: string; line: number; frames: { id: number; name: string; line: number }[]; locals: Variable[] };
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
export type Variable = { name: string; type: string; summary: string; size?: number };
export type Figure = { run: string; n: number; mime: string; source: string; kind: Kind; time: string; thumb?: boolean };
type Session = { lease: Lease; rt: Runtime; cwd?: string };
export type Values = { kind: "scalar"; value: number } | { kind: "vector"; values: number[] } | { kind: "matrix"; rows: number[][] };
/** A Julia string literal: JSON's escapes, and `$` taken literally. */
const jl = (s: string) => JSON.stringify(s).replaceAll("$", "\\$");

const INTERRUPT_GRACE_MS = 3000;   // after an interrupt with no reply, the session restarts (paperboat docs/runtime.md)
// A JulixPlot figure first (drawn by the page, interactive), then images; one file per figure.
export const FIGURE = "application/vnd.paperboat.figure+json";
const IMAGES = [FIGURE, "image/svg+xml", "image/png"] as const;
const EXT: Record<string, string> = { [FIGURE]: "json", "image/svg+xml": "svg", "image/png": "png" };
const MIME_OF: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
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
  /** The debug run's stop, while it waits (for a page that opens later than the event). */
  paused?: Paused;
  /** This session's runs, newest last (the console after a page reload); a new session starts empty. */
  runs: Run[] = [];
  variables: Variable[] = [];
  /** Whether Julia is up, for a page that opens later than the event that said so. */
  state: "stopped" | "starting" | "running" = "stopped";
  private set(state: Sessions["state"]) { this.state = state; this.emit({ type: "session", state }); }

  private folder: Folder;
  private control: Control;
  /** A lease still starting: its runtime ending rejects the wait for its socket (no two-minute freeze). */
  private starting = new Map<string, (e: Error) => void>();
  private emit: (e: Record<string, unknown>) => void;

  constructor(folder: Folder, control: Control, emit: (e: Record<string, unknown>) => void) {
    this.folder = folder;
    this.control = control;
    this.emit = emit;
    control.onEvent = (e) => {
      this.emit({ type: "runtime", event: e });
      if (e.event === "runtime.exited" || e.event === "runtime.failed") this.starting.get(String(e.lease))?.(new Error(`Julia stopped while starting${e.error ? `: ${e.error}` : ""}`));
      if ((e.event === "runtime.exited" || e.event === "runtime.failed") && this.session)
        this.session.then((s) => { if (s.lease.id === e.lease || s.lease.id === (e as any).id) this.drop(); }, () => {});
    };
    control.onClose = () => this.drop();
  }

  private open(): Promise<Session> {
    this.session ??= (async () => {
      this.set("starting");
      // JulixPlot comes with Julix: added to the folder's project before the first session, once
      if (!hasJulixPlot(this.folder.root)) this.emit({ type: "packages", packages: (await packages(this.control, this.folder, "add", "JulixPlot")).packages });
      // ponytail: one retry; a Julia that ends while starting (seen once, exit 0, no output) usually starts the second time
      const start = async (): Promise<{ lease: Lease; rt: Runtime }> => {
        const lease = await this.control.call<Lease>("acquire", { runtime: "julia", mode: "session", project: this.folder.root, owner: OWNER(this.folder) });
        if (lease.state === "failed") throw new Error(lease.error ?? "Julia failed to start");
        const ended = new Promise<never>((_, reject) => this.starting.set(lease.id, reject));
        try { return { lease, rt: await Promise.race([Runtime.connect(path.join(lease.ipc, "runtime.sock"), 120_000), ended]) }; }
        catch (e) { this.control.call("release", { lease: lease.id }).catch(() => {}); throw e; }
        finally { this.starting.delete(lease.id); }
      };
      const { lease, rt } = await start().catch(() => start());
      rt.onClose = () => this.drop();
      this.set("running");
      return { lease, rt };
    })();
    this.session.catch(() => { this.session = undefined; this.set("stopped"); });
    return this.session;
  }

  private drop() {
    const p = this.session;
    this.session = undefined;
    this.variables = [];
    this.runs = [];
    this.paused = undefined;
    p?.then((s) => { s.rt.close(); this.control.call("release", { lease: s.lease.id }).catch(() => {}); }, () => {});
    this.set("stopped");
    this.emit({ type: "variables", variables: [] });
  }

  figuresDir(run?: string) { return path.join(this.folder.root, ".julix", "figures", ...(run ? [run] : [])); }

  /** Runs `code` from `source` (a workspace path, or "console") at `line`; runs go one after another. */
  run(kind: Kind, source: string, code: string, line = 1, debug?: { breakpoints: Breakpoint[] }): Run {
    const run: Run = { id: runId(), kind, source, line, code, state: "queued", outputs: [], ...(debug ? { debug: true } : {}) };
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
        const args = { code: atLine(code, line), cell: label, ...(debug ? { debug: true, breakpoints: debug.breakpoints } : {}) };
        const result = await s.rt.request<{ data: Record<string, string> | null; stopped?: boolean }>("eval", args, (note) => {
          if (note.type === "debug") {
            this.paused = note.event === "stopped" ? { run: run.id, source, reason: String(note.reason), line: Number(note.line),
              frames: note.frames as Paused["frames"], locals: note.locals as Variable[] } : undefined;
            this.emit({ type: "debug", paused: this.paused ?? null, run: run.id });
            return;
          }
          if (note.type === "stream") {
            const last = run.outputs.at(-1);
            if (last?.type === "stream" && last.name === note.name) last.text += note.text;
            else run.outputs.push({ type: "stream", name: note.name, text: note.text });
          } else if (note.type === "display" && !figure(note.data)) run.outputs.push({ type: "result", data: note.data });
          send();
        });
        if (result?.data && !figure(result.data)) run.outputs.push({ type: "result", data: result.data });
        if (result?.stopped) run.outputs.push({ type: "stream", name: "stdout", text: "debugging stopped\n" });
        state = "done";
      } catch (e) {
        run.outputs.push({ type: "error", error: e instanceof RuntimeError ? e.error : { type: "julix", message: String((e as Error).message ?? e) } });
        state = "failed";
      }
      run.ms = Date.now() - t0;
      if (debug) { this.paused = undefined; this.emit({ type: "debug", paused: null, run: run.id, ended: true }); }
      await this.refreshVariables();   // before "done", so a finished run never shows the variables before it
      run.state = state;
      if (figures) fs.writeFileSync(path.join(this.figuresDir(run.id), "run.json"), JSON.stringify({ ...run, outputs: undefined }));
      if (this.running === run) this.running = undefined;
      send();
    });
    return run;
  }

  /** Steers the debug run at once (never queued behind it): continue, over, into, out, pause, stop,
   *  breakpoints (a file's, while it runs), locals (of a frame), eval (in a frame). */
  async debug(command: string, args: Record<string, unknown> = {}) {
    if (!this.session) return { running: false };
    const s = await this.session;
    const label = typeof args.file === "string" ? args.file.replace(/^@examples\//, "examples/") : undefined;
    return s.rt.request("debug", { command, ...args, ...(label ? { file: label } : {}) });
  }

  /** The session's variables, asked after every run (and sent to the page). */
  async refreshVariables() {
    const s = await this.session?.catch(() => undefined);
    if (!s) return;
    try { this.variables = await s.rt.request<Variable[]>("variables"); } catch { return; }
    this.variables.sort((a, b) => a.name.localeCompare(b.name));
    this.emit({ type: "variables", variables: this.variables });
  }

  /** The editor's and the console's questions to the session (`lint`, `complete`), passed as they are: the
   *  kit's languages speak paperboat-runtime/0 themselves. Null while no session runs: Julia is not started
   *  just to lint, so the editor colours the code and waits for the first run. */
  async ask(op: "lint" | "complete", args: Record<string, unknown>): Promise<unknown> {
    const s = await this.session?.catch(() => undefined);
    return s ? s.rt.request(op, args) : null;
  }

  /** Julix's own question to the session: what `code` prints. Queued with runs; the code ends with `;` and
   *  prints rather than returns, so the user's `ans` stays theirs, and nothing reaches the console.
   *  `start`: start Julia for it (Help does; the Workspace plot only reads a session that is up). */
  private quiet(code: string, label: string, start = false): Promise<string> {
    const out = this.queue.then(async () => {
      const s = start ? await this.open() : await this.session?.catch(() => undefined);
      if (!s) return "";
      let text = "";
      await s.rt.request("eval", { code, cell: `julix: ${label}` }, (n) => { if (n.type === "stream") text += n.text; });
      return text;
    });
    this.queue = out.catch(() => {});
    return out;
  }

  private known(name: string) { return this.variables.some((v) => v.name === name); }   // only a name the session listed
  private ref = (name: string) => `getfield(@__MODULE__, Symbol(${jl(name)}))`;

  /** A variable's numbers (the Workspace plot, the variable editor): a real scalar, vector (up to 100 000)
   *  or matrix (up to 400 × 400); null for anything else. */
  async values(name: string): Promise<Values | null> {
    if (!this.known(name)) return null;
    const text = await this.quiet(`let v = ${this.ref(name)}
  if v isa Real
    print("s", Float64(v))
  elseif v isa AbstractVector{<:Real} && length(v) <= 100_000
    print("v", join(Float64.(v), ","))
  elseif v isa AbstractMatrix{<:Real} && all(<=(400), size(v))
    print("m", size(v, 2), ";", join(Float64.(vec(permutedims(v))), ","))
  end
end;`, "workspace", false).catch(() => "");
    const num = (x: string) => (x === "Inf" ? Infinity : x === "-Inf" ? -Infinity : Number(x));   // NaN reads as NaN
    if (text.startsWith("s")) return { kind: "scalar", value: num(text.slice(1)) };
    if (text.startsWith("v")) return { kind: "vector", values: text.length > 1 ? text.slice(1).split(",").map(num) : [] };
    const m = /^m(\d+);(.*)$/s.exec(text);
    if (!m) return null;
    const cols = Number(m[1]), all = m[2] ? m[2].split(",").map(num) : [], rows: number[][] = [];
    for (let i = 0; i < all.length; i += cols) rows.push(all.slice(i, i + cols));
    return { kind: "matrix", rows };
  }

  /** The variable editor's change: the same name, the new numbers, its element type kept (Int stays Int). */
  async setValues(name: string, value: number | number[] | number[][]): Promise<void> {
    if (!this.known(name)) throw new Error(`${name} isn't a variable of the session`);
    const ints = /^(Int|Vector\{Int|Matrix\{Int|Array\{Int)/.test(this.variables.find((v) => v.name === name)!.type);
    const lit = (x: number) => { if (!Number.isFinite(x)) return x !== x ? "NaN" : x > 0 ? "Inf" : "-Inf"; return ints ? String(Math.round(x)) : String(x).includes(".") || /e/i.test(String(x)) ? String(x) : `${x}.0`; };
    const T = ints ? "Int" : "Float64";
    const code = typeof value === "number" ? lit(value)
      : Array.isArray(value[0]) ? `${T}[${(value as number[][]).map((r) => r.map(lit).join(" ")).join("; ")}]`
      : `${T}[${(value as number[]).map(lit).join(", ")}]`;
    await this.quiet(`Core.eval(@__MODULE__, :(${name} = ${code}));`, "variable editor", false);
    await this.refreshVariables();
  }

  /** Help (F1): names that match in the session and the modules it loaded, and a name's docstring as HTML. */
  async helpItems(query: string): Promise<{ id: string; title: string; kind: string; summary: string }[]> {
    const text = await this.quiet(`let q = lowercase(${jl(query)}), n = 0, mods = unique!([@__MODULE__, Base, Core, values(Base.loaded_modules)...])
  hits = Tuple{Int, String, String, String}[]
  for m in mods, s in names(m)
    t = string(s)
    (occursin(q, lowercase(t)) && isdefined(m, s) && !startswith(t, "#")) || continue
    v = getfield(m, s)
    kind = v isa Module ? "module" : v isa Function ? "function" : v isa Type ? "type" : "value"
    push!(hits, (startswith(lowercase(t), q) ? (length(t) == length(q) ? 0 : 1) : 2, string(nameof(m)), t, kind))
  end
  for (_, m, t, kind) in first(sort!(unique!(hits)), 60)
    println(m, "\\t", t, "\\t", kind)
  end
end;`, "help", true);
    return text.split("\n").filter(Boolean).map((l) => { const [m, t, kind] = l.split("\t"); return { id: `${m}.${t}`, title: t, kind, summary: m }; });
  }

  async helpPage(id: string): Promise<string> {
    const dot = id.lastIndexOf("."), mod = id.slice(0, dot), name = id.slice(dot + 1);
    return this.quiet(`let mods = unique!([@__MODULE__, Base, Core, values(Base.loaded_modules)...]), i = findfirst(m -> string(nameof(m)) == ${jl(mod)}, mods)
  i === nothing || print(sprint(show, MIME"text/html"(), Base.Docs.doc(Base.Docs.Binding(mods[i], Symbol(${jl(name)})))))
end;`, "help", true);
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
        const m = /^(\d+)\.(json|svg|png)$/.exec(f);
        if (m) out.push({ run: id, n: Number(m[1]), mime: MIME_OF[m[2]], source: meta.source, kind: meta.kind, time: meta.started ?? "",
          thumb: fs.existsSync(path.join(root, id, `${m[1]}.thumb.png`)) });
      }
    }
    return out.sort((a, b) => (a.run === b.run ? a.n - b.n : a.run < b.run ? 1 : -1));
  }

  figureFile(run: string, n: number, thumb = false): string {
    if (!/^[\w-]+$/.test(run)) throw new Error("bad run");
    if (thumb) { const p = path.join(this.figuresDir(run), `${n}.thumb.png`); if (fs.existsSync(p)) return p; throw new Error("no preview"); }
    for (const ext of ["json", "svg", "png"]) { const p = path.join(this.figuresDir(run), `${n}.${ext}`); if (fs.existsSync(p)) return p; }
    throw new Error("no such figure");
  }

  /** A JulixPlot figure's preview, as the page drew it (the runtime sends a scene, never an image). */
  saveThumb(run: string, n: number, png: string) {
    const bytes = Buffer.from(png, "base64");
    if (!/^[\w-]+$/.test(run) || !Number.isInteger(n) || n < 1) throw new Error("bad figure");
    if (bytes.length > 512 << 10 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("a preview is a small PNG");
    if (!fs.existsSync(path.join(this.figuresDir(run), `${n}.json`))) throw new Error("no such figure");
    fs.writeFileSync(path.join(this.figuresDir(run), `${n}.thumb.png`), bytes);
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
