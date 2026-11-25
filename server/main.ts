// The Julix app server: `julix <folder> [--port N]`. Serves the page (dist/), a JSON API over the
// workspace and its Julia session, and Server-Sent Events for what changes (files, runs, variables, the
// session). It listens on 127.0.0.1 only and answers only requests addressed to it (Host) from its own
// page (Origin), so a web page elsewhere can't drive it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Control, ControlError, paperboatVersion } from "./control.ts";
import { Folder, FolderError } from "./folder.ts";
import { PackageError, packages } from "./packages.ts";
import { Sessions, type Kind } from "./session.ts";

export const DEFAULT_PORT = 30473;   // Julix's home port (paperboat/apps.toml); other folders get --port from the CLI (30500–30599)
export const VERSION = "0.1.0";
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json",
};
const KINDS = new Set<Kind>(["file", "cell", "line", "console"]);

export function serve(dir: string, port = DEFAULT_PORT, control = new Control()) {
  const folder = new Folder(dir);
  const clients = new Set<http.ServerResponse>();
  const emit = (e: Record<string, unknown>) => { const s = `data: ${JSON.stringify(e)}\n\n`; for (const c of clients) c.write(s); };
  const sessions = new Sessions(folder, control, emit);

  // the tree follows the files: whoever changed them (this server, another editor, git)
  let pending = new Set<string>(), timer: NodeJS.Timeout | undefined;
  const watcher = fs.watch(folder.root, { recursive: true }, (_ev, f) => {
    if (!f) return;
    const rel = f.toString().split(path.sep).join("/");
    if (rel.split("/").some((p) => p.startsWith(".") || p === "node_modules") || rel.endsWith(".tmp")) return;
    pending.add(rel);
    clearTimeout(timer);
    timer = setTimeout(() => { emit({ type: "files", changed: [...pending] }); pending = new Set(); }, 120);
  });

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
      switch (`${req.method} ${url.pathname}`) {
        case "GET /api/folder": return send(res, 200, { name: folder.name, root: folder.root, version: VERSION, session: sessions.state });
        case "GET /api/paperboat": return send(res, 200, { version: await paperboatVersion() });
        case "GET /api/tree": return send(res, 200, { files: folder.tree(), examples: folder.exampleTree() });
        case "GET /api/file": return send(res, 200, { path: q("path"), text: folder.read(q("path")), readOnly: Folder.readOnly(q("path")) });
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
        case "GET /api/runtimes": return send(res, 200, await sessions.peek());
        case "GET /api/packages": return send(res, 200, await packages(control, folder, "list"));
        case "POST /api/packages": {   // add (the page has asked the user: the network opens for this step) or remove
          const op = str("op");
          if (op !== "add" && op !== "remove") throw new FolderError("op is add or remove");
          const r = await packages(control, folder, op, str("name"));
          emit({ type: "packages", packages: r.packages });
          return send(res, 200, r);
        }
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
  server.on("close", () => { watcher.close(); sessions.close(); for (const c of clients) c.end(); });
  return { server, folder, sessions };
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
  const dir = args[0];
  if (!dir || args.includes("--help") || args.includes("-h")) {
    console.log("usage: julix <folder> [--port N]\n  Opens the folder as Julix's workspace and serves it on 127.0.0.1.");
    process.exit(dir ? 0 : 2);
  }
  fs.mkdirSync(dir, { recursive: true });
  const { server, folder } = serve(dir, port);
  server.on("listening", () => console.log(`Julix: ${folder.name} (${folder.root}) on http://127.0.0.1:${port}/`));
  server.on("error", (e) => { console.error(`julix: ${e.message}`); process.exit(1); });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { server.close(); process.exit(0); });
}
