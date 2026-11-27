// The hubs (paperboat#16, plans/2026-11-25_14-55_hub_standard.md §3): Malachite's, learned from
// `paperboat hub list --json` when the page asks (the well, Connect to a hub, a file opened from outside).
// No Malachite, no hub: a CLI that is missing, fails or has no `hub` command means no hubs, and the page says nothing.
// The examples (paperboat#72, #75) come from the same CLI: `paperboat example list --app julix`, `example open <id>`
// (in place, in a new window whose banner offers a copy) and `example copy <id> --to <folder> --open`.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Place = "local" | "google-drive" | "onedrive" | "dropbox" | "icloud";
/** A hub as `hub list` gives it: `path` absolute, `shown` with ~, `missing` when its folder is gone. */
export type HubInfo = { id: string; name: string; path: string; shown: string; place: Place; missing?: boolean; conflicts?: number; holds?: string };
const PLACES = new Set<string>(["local", "google-drive", "onedrive", "dropbox", "icloud"]);

/** `paperboat <args> --json` ($PAPERBOAT_BIN, else on PATH; no shell), its output parsed; rejects on any failure. */
export function paperboat(args: string[], timeout = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(process.env.PAPERBOAT_BIN || "paperboat", [...args, "--json"], { timeout, maxBuffer: 4 << 20 }, (err, out, errOut) => {
      if (err) {   // with --json the CLI says why as {error} on stdout
        let why: unknown; try { why = JSON.parse(out).error; } catch { /* not JSON */ }
        return reject(new Error(typeof why === "string" ? why : String(errOut).trim().split("\n").pop() || err.message));
      }
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`paperboat ${args.join(" ")}: not JSON`)); }
    });
  });
}

/** The hubs this machine knows, or [] without Malachite. */
export async function hubs(): Promise<HubInfo[]> {
  const list = await paperboat(["hub", "list"]).catch(() => null);
  if (!Array.isArray(list)) return [];
  return list.filter((h) => h && typeof h.id === "string" && typeof h.path === "string").map((h) => ({
    id: h.id, path: h.path,
    name: typeof h.name === "string" && h.name ? h.name : h.path.split(/[\\/]/).pop(),
    shown: typeof h.shown === "string" ? h.shown : h.path,
    place: PLACES.has(h.place) ? h.place : "local",
    ...(h.missing ? { missing: true } : {}),
    ...(Array.isArray(h.conflicts) && h.conflicts.length ? { conflicts: h.conflicts.length } : {}),
  }));
}

/** An example as `example list` gives it (paperboat#72). */
export type Example = { id: string; app: string; kind: string; name: string; description: string; path: string };

/** Julix's examples, or [] without the CLI (or with one that fails): Julix works without Paperboat. */
export async function examples(): Promise<Example[]> {
  const list = await paperboat(["example", "list", "--app", "julix"], 60_000).catch(() => null);   // the first list may fetch the examples
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && typeof e.id === "string" && typeof e.name === "string").map((e) => ({
    id: e.id, name: e.name, app: String(e.app ?? "julix"), kind: String(e.kind ?? "julix"), description: String(e.description ?? ""), path: String(e.path ?? ""),
  }));
}

const exampleId = (id: string) => { if (!/^[\w.]+(\/[\w.-]+)*$/.test(id)) throw new Error(`no example ${JSON.stringify(id)}`); return id; };   // an id, never an option

/** Opens an example where it is (its checkout or GitHub's cache), in a new window; `to`: the folder it was opened
 *  from, where its banner's Copy goes. Rejects with the CLI's error. */
export async function openExample(id: string, to?: string): Promise<unknown> {
  return paperboat(["example", "open", exampleId(id), ...(to ? ["--to", to] : [])], 60_000);
}

/** Copies an example into `to` (an absolute folder) and opens the copy in a new window. Rejects with the CLI's error. */
export async function copyExample(id: string, to: string): Promise<unknown> {
  return paperboat(["example", "copy", exampleId(id), "--to", to, "--open"], 60_000);
}

/** What Julix opens (the pickers' types). */
export const TYPES = ["jl", "mx"];

/** How many scripts a hub holds, in words ("4 scripts"), for Connect to a hub. Dot folders are skipped. */
export function holds(root: string): string {
  let n = 0, seen = 0;
  const walk = (dir: string) => {
    let list: fs.Dirent[] = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      if (d.name.startsWith(".") || d.name === "node_modules" || ++seen > 20_000) continue;   // ponytail: a 20 000 entry cap, not a background count
      if (d.isDirectory()) walk(path.join(dir, d.name));
      else if (TYPES.includes(path.extname(d.name).slice(1).toLowerCase())) n++;
    }
  };
  walk(root);
  return n === 1 ? "1 script" : `${n} scripts`;
}
