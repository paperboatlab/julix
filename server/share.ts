// Julix's shared variables: the session's variables, live in every running Simplicial station (MATLAB's workspace
// under Simulink's models). A station keeps a record of itself while it runs (`<tmp>/paperboat-runtime/
// station-<port>.json`, Simplicial's StationManager); Julix keeps a WebSocket to each one (paperboat/0) and sends
// `variables.set` with `source: "julix"` after every run. The station shares the list with every page on it,
// resolves the flow's own variables first and Julix's under the names the flow doesn't use, and drops them when
// this socket closes (Julix quits). Nothing is asked of Julia while no station runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SharedVariable } from "./session.ts";

/** Where running stations say where they are (the engine's `platform::shared_tmp_dir()`). */
export const RECORDS = path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "paperboat-runtime");
const SCAN_MS = 5000;

/** The stations running now: their WebSocket addresses, from the records whose process is alive. */
export function stations(dir = RECORDS): string[] {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const f of names) {
    if (!/^station-\d+\.json$/.test(f)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { pid?: number; port?: number; ws_url?: string };
      if (typeof r.pid !== "number" || !alive(r.pid)) continue;
      // the engine listens on 127.0.0.1: "localhost" could try ::1 first
      const url = typeof r.ws_url === "string" && r.ws_url ? r.ws_url : `ws://127.0.0.1:${r.port}`;
      out.push(url.replace("//localhost:", "//127.0.0.1:"));
    } catch { /* half written, or not ours: the next scan reads it */ }
  }
  return out;
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export class Share {
  private sockets = new Map<string, WebSocket>();
  private last: SharedVariable[] = [];
  private read: () => Promise<SharedVariable[]> = async () => [];
  private timer: NodeJS.Timeout;
  private find: () => string[];

  constructor(find: () => string[] = stations) {
    this.find = find;
    this.timer = setInterval(() => this.scan(), SCAN_MS);
    this.timer.unref();
    this.scan();
  }

  /** The variables may have changed (a run ended, a session started or ended): `read` gives them as they are. */
  changed(read: () => Promise<SharedVariable[]>) {
    this.read = read;
    if (this.sockets.size) void this.send();
  }

  /** How many stations hear Julix now. */
  get count() { return [...this.sockets.values()].filter((w) => w.readyState === WebSocket.OPEN).length; }

  close() {
    clearInterval(this.timer);
    for (const w of this.sockets.values()) w.close();
    this.sockets.clear();
  }

  private async send() {
    const list = await this.read().catch(() => this.last);
    this.last = list;
    const msg = JSON.stringify({ type: "variables.set", source: "julix", variables: list });
    for (const w of this.sockets.values()) if (w.readyState === WebSocket.OPEN) w.send(msg);
  }

  private scan() {
    for (const url of this.find()) {
      if (this.sockets.has(url)) continue;
      let w: WebSocket;
      try { w = new WebSocket(url); } catch { continue; }
      this.sockets.set(url, w);
      // a new station gets the variables as they are now (Julia is asked once more: the last run may be newer)
      w.addEventListener("open", () => void this.send());
      w.addEventListener("close", () => { if (this.sockets.get(url) === w) this.sockets.delete(url); });
      w.addEventListener("error", () => w.close());
      // the station's own messages (its hello, catalog, scene) are for pages, not for Julix
    }
  }
}
