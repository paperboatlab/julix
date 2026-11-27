// The Julix app server: `julix [<folder>] [--port N]`. Serves the page (dist/), a JSON API over the
// workspace and its Julia session, and Server-Sent Events for what changes (files, runs, variables, the
// session). It listens on 127.0.0.1 only and answers only requests addressed to it (Host) from its own
// page (Origin), so a web page elsewhere can't drive it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Control, ControlError, paperboatVersion } from "./control.ts";
import { Folder, FolderError } from "./folder.ts";
import { copyExample, examples, holds, hubs, openExample, paperboat } from "./hubs.ts";
import { forget, isScale, isTheme, recent, remember, saveSettings, settings } from "./store.ts";
import { PackageError } from "./packages.ts";
import { Sessions, type Kind } from "./session.ts";
import { Share } from "./share.ts";

export const DEFAULT_PORT = 30473;   // Julix's home port (paperboat/apps.toml); other folders get --port from the CLI (30500–30599)
export const VERSION = "0.1.0";
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json",
};
const KINDS = new Set<Kind>(["file", "cell", "line", "console"]);

/** What Julix works in: a folder, a hub (`hub`: its id), or nothing (the page shows Start). */
export type Workspace = { kind: "folder" | "hub"; root: string; name: string; hub?: string };

const within = (root: string, p: string) => p === root || p.startsWith(root + path.sep);
const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
/** A path the page typed or the shell gave: absolute, `~` the home folder. */
function absolute(p: string): string {
  if (typeof p !== "string" || !p.trim() || p.includes("\0")) throw new FolderError("bad path");
  const t = p.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!path.isAbsolute(t)) throw new FolderError("a whole path: from / or ~");
  return path.resolve(t);
}

/** `share`: the session's variables go live to every running Simplicial station (the julix command shares; a test
 *  doesn't, so it never reaches a station the machine is running). */
export function serve(dir: string | null, port = DEFAULT_PORT, control = new Control(), share: Share | null = null) {
  let ws: Workspace | null = null;
  let folder: Folder | null = null;
  let sessions: Sessions | null = null;
  const clients = new Set<http.ServerResponse>();
  const emit = (e: Record<string, unknown>) => {
    const s = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of clients) c.write(s);
    // the variables changed (a run ended, a session started or ended): the stations take them as they are now
    if (e.type === "variables") share?.changed(() => sessions ? sessions.shared() : Promise.resolve([]));
  };

  // the tree follows the files: whoever changed them (this server, another editor, git)
  let pending = new Set<string>(), timer: NodeJS.Timeout | undefined;
  const watch = (root: string) => fs.watch(root, { recursive: true }, (_ev, f) => {
    if (!f) return;
    const rel = f.toString().split(path.sep).join("/");
    if (rel.split("/").some((p) => p.startsWith(".") || p === "node_modules") || rel.endsWith(".tmp")) return;
    pending.add(rel);
    clearTimeout(timer);
    timer = setTimeout(() => { emit({ type: "files", changed: [...pending] }); pending = new Set(); }, 120);
  });
  let watcher: fs.FSWatcher | null = null;

  // the workspace, switched at runtime: a new folder is a new Folder, a new Julia session (the old one is
  // released) and a new watcher; null is no workspace (Start). What opens goes first in recent.json.
  const workIn = (root: string | null, hub?: { id: string; name: string }): Workspace | null => {
    const r = root && fs.realpathSync(root);
    if (r !== (folder?.root ?? null)) {
      sessions?.restart(); watcher?.close(); clearTimeout(timer); pending = new Set();
      folder = r ? new Folder(r) : null;
      sessions = folder && new Sessions(folder, control, emit);
      watcher = folder && watch(folder.root);
    }
    ws = folder && { kind: hub ? "hub" : "folder", root: folder.root, name: hub?.name ?? folder.name, ...(hub ? { hub: hub.id } : {}) };
    if (ws) remember({ kind: ws.kind, path: ws.root, hub: ws.hub });
    emit({ type: "folder" });
    return ws;
  };
  /** The known hub whose folder holds `p` (or is it). */
  const hubOf = async (p: string) => (await hubs()).find((h) => !h.missing && within(real(h.path), p));
  /** A folder: a hub when it is one's folder, else a plain folder. */
  const openFolder = async (p: string) => {
    const abs = real(absolute(p));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new FolderError(`no folder ${p}`, 404);
    const h = (await hubs()).find((x) => !x.missing && real(x.path) === abs);
    return workIn(abs, h);
  };
  /** A file from anywhere: inside the workspace it just opens; from outside, the workspace switches to its
   *  hub (when a known hub holds it) or its folder. Returns its path in the workspace. */
  const openFile = async (p: string) => {
    const abs = real(absolute(p));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new FolderError(`no file ${p}`, 404);
    if (!folder || !within(folder.root, abs)) {
      const h = await hubOf(abs);
      workIn(h ? h.path : path.dirname(abs), h);
    }
    remember({ kind: "file", path: abs, hub: ws!.hub });
    return { workspace: ws, path: path.relative(folder!.root, abs).split(path.sep).join("/") };
  };
  // a folder given at the start (paperboat app open julix <folder>): a hub when it is one
  const ready = dir ? openFolder(dir).catch((e) => { console.error(`julix: ${e.message}`); return null; }) : Promise.resolve(null);

  const hosts = () => { const p = (server.address() as any)?.port; return [`127.0.0.1:${p}`, `localhost:${p}`]; };

  const DEBUG = new Set(["continue", "over", "into", "out", "pause", "stop", "breakpoints", "locals", "eval"]);
  const breakpoints = (v: unknown) => (Array.isArray(v) ? v : []).filter((b) => b && Number.isInteger(b.line) && b.line > 0)
    .map((b) => ({ line: b.line as number, enabled: b.enabled !== false, condition: typeof b.condition === "string" ? b.condition : "" }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (!hosts().includes(req.headers.host ?? "")) return send(res, 421, { error: "wrong host" });
      if (req.method !== "GET" && req.headers.origin && !hosts().some((h) => req.headers.origin === `http://${h}`)) return send(res, 403, { error: "wrong origin" });
      if (!url.pathname.startsWith("/api/") && url.pathname !== "/events") return file(res, url.pathname);
      if (url.pathname === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": julix\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      const q = (k: string) => { const v = url.searchParams.get(k); if (v === null) throw new FolderError(`missing ${k}`); return v; };
      const body = req.method === "GET" ? {} : await json(req);
      const str = (k: string) => { const v = body[k]; if (typeof v !== "string") throw new FolderError(`missing ${k}`); return v; };
      switch (`${req.method} ${url.pathname}`) {   // what works with no workspace (the Start page)
        case "GET /api/workspace": { await ready; return send(res, 200, { workspace: ws, home: os.homedir(), version: VERSION, session: sessions?.state ?? "stopped" }); }
        case "POST /api/workspace": {   // { kind: "folder", path } | { kind: "hub", id } | { kind: null }: Close
          if (body.kind === "folder") return send(res, 200, await openFolder(str("path")));
          if (body.kind !== "hub") return send(res, 200, workIn(null));
          const h = (await hubs()).find((x) => x.id === str("id"));
          if (!h) throw new FolderError("no such hub", 404);
          if (h.missing) throw new FolderError(`can't find ${h.name}'s folder (${h.shown})`, 410);
          return send(res, 200, workIn(h.path, h));
        }
        case "POST /api/open": return send(res, 200, await openFile(str("path")));   // a file by its whole path (the shell's, or typed)
        case "POST /api/saveas": {   // { path, text, new? }: a file written by its whole path, then opened (new: never over one)
          const abs = absolute(str("path"));
          if (body.new === true && fs.existsSync(abs)) throw new FolderError(`${str("path")} exists`, 409);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          const tmp = `${abs}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, str("text"));
          fs.renameSync(tmp, abs);
          return send(res, 200, await openFile(abs));
        }
        case "GET /api/recent": return send(res, 200, { version: 1, recent: recent() });
        case "POST /api/recent": {   // a file of the workspace opened in the editor
          if (!folder) throw new FolderError("no folder open", 409);
          remember({ kind: "file", path: folder.resolve(str("path")), hub: ws?.hub });
          return send(res, 200, {});
        }
        case "POST /api/recent/clear": { forget(); return send(res, 200, {}); }
        case "GET /api/settings": return send(res, 200, settings());
        case "PUT /api/settings": {
          const { theme, scale } = body;   // either or both
          if (theme !== undefined && !isTheme(theme)) throw new FolderError("theme is light, dark or system");
          if (scale !== undefined && !isScale(scale)) throw new FolderError("scale is 0.75, 1 or 1.25");
          saveSettings({ ...(theme !== undefined ? { theme } : {}), ...(scale !== undefined ? { scale } : {}) });
          return send(res, 200, settings());
        }
        case "GET /api/hubs": {   // with what each holds, for Connect to a hub
          const list = await hubs();
          return send(res, 200, list.map((h) => (h.missing ? h : { ...h, holds: holds(h.path) })));
        }
        case "POST /api/hubs/new": {   // New hub…: Malachite makes it (paperboat hub new), Julix works in it
          const name = str("name").trim();
          if (!name || /[\\/"]/.test(name)) throw new FolderError("a hub's name has no / \\ or quotes");
          const made = await paperboat(["hub", "new", name]).catch((e) => { throw new FolderError(e.message, 502); }) as { id: string; path: string };
          return send(res, 200, workIn(made.path, { id: made.id, name }));
        }
        case "POST /api/hubs/malachite": {   // Open in Malachite: the CLI opens it (a Paperboat window, else the browser)
          const h = (await hubs()).find((x) => x.id === str("id") && !x.missing);
          if (!h) throw new FolderError("no such hub", 404);
          await paperboat(["app", "open", "malachite", h.path], 60_000).catch((e) => { throw new FolderError(e.message, 502); });
          return send(res, 200, {});
        }
        case "POST /api/launcher": {   // Manage runtimes…: the Launcher on Runtimes › julia (paperboat#69)
          await paperboat(["launcher", "--page", "runtimes", "--runtime", "julia"]).catch((e) => { throw new FolderError(e.message, 502); });
          return send(res, 200, {});
        }
        case "GET /api/examples": return send(res, 200, await examples());   // Open example: in Ctrl K (paperboat#72)
        case "POST /api/examples/open":   // in place; its Copy goes to this workspace's folder, if one is open (paperboat#75)
          return send(res, 200, await openExample(str("id"), ws?.root).catch((e) => { throw new FolderError(e.message, 502); }));
        case "POST /api/examples/copy": {   // the banner's Copy: into `to`, the copy opened in a new window
          const to = absolute(str("to"));   // a whole path, so never an option
          return send(res, 200, await copyExample(str("id"), to).catch((e) => { throw new FolderError(e.message, 502); }));
        }
        case "GET /api/paperboat": return send(res, 200, { version: await paperboatVersion() });
        case "GET /api/runtimes": {   // the runtimes key: this workspace's session, or only whether Julia is there
          if (sessions) return send(res, 200, await sessions.peek());
          const list = await control.call<{ runtimes: { name: string; version: string; modes: string[] }[] }>("runtimes.list");
          return send(res, 200, { sessions: [], julia: list.runtimes.find((r) => r.name === "julia" && r.modes.includes("session")) ?? null });
        }
      }
      if (!folder || !sessions) throw new FolderError("no folder open: open one first", 409);
      switch (`${req.method} ${url.pathname}`) {
        case "GET /api/tree": return send(res, 200, { files: folder.tree() });
        case "GET /api/file": return send(res, 200, { path: q("path"), text: folder.read(q("path")) });
        case "PUT /api/file": { folder.write(q("path"), str("text")); return send(res, 200, {}); }
        case "POST /api/new": return send(res, 200, { path: folder.create(str("path"), typeof body.text === "string" ? body.text : "") });
        case "POST /api/mkdir": { folder.mkdir(str("path")); return send(res, 200, {}); }
        case "POST /api/move": { folder.rename(str("from"), str("to")); return send(res, 200, {}); }
        case "POST /api/copy": return send(res, 200, { path: folder.copyIn(str("from"), str("to")) });
        case "POST /api/trash": { folder.trash(str("path")); return send(res, 200, {}); }
        case "POST /api/reveal": {   // the folder in the OS file manager (this server runs on the user's machine)
          const abs = folder.resolve(str("path")), d = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
          spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [d], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
          return send(res, 200, {});
        }
        case "POST /api/run": {
          const kind = str("kind") as Kind;
          if (!KINDS.has(kind)) throw new FolderError("kind is file, cell, line or console");
          const source = kind === "console" ? "console" : str("path");
          if (source !== "console") folder.resolve(source);   // a path the page names stays in the folder
          const code = kind === "file" && typeof body.code !== "string" ? folder.read(source) : str("code");
          // a debug run: the file's breakpoints go with it (lines, and conditions: Julia code read where it stops)
          const debug = body.debug === true && kind !== "console" ? { breakpoints: breakpoints(body.breakpoints) } : undefined;
          return send(res, 200, sessions.run(kind, source, code, Number(body.line ?? 1) || 1, debug));
        }
        case "GET /api/debug": return send(res, 200, { paused: sessions.paused ?? null });
        case "POST /api/debug": {
          const command = str("command");
          if (!DEBUG.has(command)) throw new FolderError(`command is one of ${[...DEBUG].join(", ")}`);
          const args: Record<string, unknown> = {};
          if (command === "breakpoints") { args.file = str("file"); args.breakpoints = breakpoints(body.breakpoints); }
          if (command === "locals" || command === "eval") args.frame = Number(body.frame);
          if (command === "eval") args.code = str("code");
          return send(res, 200, await sessions.debug(command, args));
        }
        case "POST /api/interrupt": return send(res, 200, await sessions.interrupt());
        case "POST /api/restart": return send(res, 200, sessions.restart());
        case "GET /api/variables": return send(res, 200, sessions.variables);
        case "GET /api/runs": return send(res, 200, sessions.runs);
        case "POST /api/session": {   // the editor's and console's lint and completion; nothing else reaches the session this way
          const op = str("op");
          if (op !== "lint" && op !== "complete") throw new FolderError("op is lint or complete");
          return send(res, 200, { result: await sessions.ask(op, body.args && typeof body.args === "object" ? body.args : {}) });
        }
        case "GET /api/values": return send(res, 200, await sessions.values(q("name")));
        case "PUT /api/values": {   // the variable editor: the same name, new numbers
          const v = body.value;
          const ok = (x: unknown) => typeof x === "number" || x === null;   // JSON has no Inf or NaN: null stands for NaN
          if (!(ok(v) || (Array.isArray(v) && v.every((r) => ok(r) || (Array.isArray(r) && r.every(ok)))))) throw new FolderError("value is a number, a list or a list of rows");
          await sessions.setValues(str("name"), JSON.parse(JSON.stringify(v), (_k, x) => (x === null ? NaN : x)));
          return send(res, 200, {});
        }
        case "GET /api/help": return send(res, 200, await sessions.helpItems(url.searchParams.get("q") ?? ""));
        case "GET /api/help/page": return send(res, 200, { html: await sessions.helpPage(q("id")) });
        case "GET /api/figures": return send(res, 200, sessions.figures());
        case "GET /api/figure": {
          const p = sessions.figureFile(q("run"), Number(q("n")), url.searchParams.has("thumb"));
          // a figure is the code's output: shown as an image, never run as a page (an SVG can hold script)
          res.writeHead(200, { "content-type": TYPES[path.extname(p)], "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:", "x-content-type-options": "nosniff", "cache-control": "no-store" });
          return fs.createReadStream(p).pipe(res);
        }
        case "POST /api/figure/thumb": { sessions.saveThumb(str("run"), Number(body.n), str("png")); emit({ type: "figures" }); return send(res, 200, {}); }
        case "POST /api/figures/remove": { sessions.removeFigures(str("run")); return send(res, 200, {}); }
        default: return send(res, 404, { error: `no ${req.method} ${url.pathname}` });
      }
    } catch (e) {
      if (e instanceof FolderError) return send(res, e.status, { error: e.message });
      if (e instanceof ControlError) return send(res, 503, { error: e.message });
      if (e instanceof PackageError) return send(res, 422, { error: e.message });
      console.error(e);
      return send(res, 500, { error: String((e as Error).message ?? e) });
    }
  });

  server.listen(port, "127.0.0.1");
  server.on("close", () => { share?.close(); watcher?.close(); sessions ? sessions.close() : control.close(); for (const c of clients) c.end(); });
  return { server, ready };
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function json(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (d) => { s += d; if (s.length > 32 << 20) { reject(new FolderError("too large", 413)); req.destroy(); } });
    req.on("end", () => { try { const v = s ? JSON.parse(s) : {}; resolve(v && typeof v === "object" ? v : {}); } catch { reject(new FolderError("bad JSON")); } });
    req.on("error", reject);
  });
}

function file(res: http.ServerResponse, p: string) {
  const rel = p === "/" ? "index.html" : decodeURIComponent(p).replace(/^\/+/, "");
  const abs = path.resolve(DIST, rel);
  if (!abs.startsWith(DIST + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, { error: "not found" });
  res.writeHead(200, { "content-type": TYPES[path.extname(abs)] ?? "application/octet-stream" });
  fs.createReadStream(abs).pipe(res);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--port");
  const port = pi >= 0 ? Number(args.splice(pi, 2)[1]) : Number(process.env.JULIX_PORT ?? DEFAULT_PORT);
  const dir = args[0] ?? null;
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: julix [<folder>] [--port N]\n  Serves Julix on 127.0.0.1, working in the folder (none: the Start page).");
    process.exit(0);
  }
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const { server } = serve(dir, port, undefined, new Share());
  server.on("listening", () => console.log(`Julix${dir ? `: ${path.resolve(dir)}` : ""} on http://127.0.0.1:${port}/`));
  server.on("error", (e) => { console.error(`julix: ${e.message}`); process.exit(1); });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { server.close(); process.exit(0); });
}
