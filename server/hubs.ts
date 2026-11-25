// The hubs (paperboat#16, plans/2026-11-25_14-55_hub_standard.md §3): Malachite's, learned from
// `paperboat hub list --json` when the page asks (its selector or connect dialog opens). No Malachite,
// no hub: a CLI that is missing, fails or has no `hub` command means no hubs, and the page says nothing.
import { execFile } from "node:child_process";

export type Place = "local" | "google-drive" | "onedrive" | "dropbox" | "icloud";
/** A hub as `hub list` gives it: `path` absolute, `shown` with ~, `missing` when its folder is gone. */
export type HubInfo = { id: string; name: string; path: string; shown: string; place: Place; missing?: boolean; conflicts?: number };
const PLACES = new Set<string>(["local", "google-drive", "onedrive", "dropbox", "icloud"]);

/** `paperboat <args> --json` ($PAPERBOAT, else on PATH; no shell), its output parsed; rejects on any failure. */
export function paperboat(args: string[], timeout = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(process.env.PAPERBOAT || "paperboat", [...args, "--json"], { timeout, maxBuffer: 4 << 20 }, (err, out, errOut) => {
      if (err) return reject(new Error(String(errOut).trim().split("\n").pop() || err.message));
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
