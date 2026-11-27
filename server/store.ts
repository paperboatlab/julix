// The store every app shares under $PAPERBOAT_HOME (plans/2026-11-26_11-05_one_file_workflow.md, "The contract"):
// `recent.json` (the folders, hubs and files opened, newest first) and `settings.json` (the theme every app
// and the interface scale every app starts in). Each is read whole and written whole, to a temp file then renamed, so another app never reads half.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** $PAPERBOAT_HOME, as paperboat/src/lib/paths.cpp and Malachite resolve it. */
export function paperboatHome(): string {
  const env = process.env;
  if (env.PAPERBOAT_HOME) return env.PAPERBOAT_HOME;
  if (process.platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "paperboat");
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "paperboat");
}

export type Theme = "light" | "dark" | "system";
export type Scale = 0.75 | 1 | 1.25;
export const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "system";
export const isScale = (v: unknown): v is Scale => v === 0.75 || v === 1 || v === 1.25;
export type RecentKind = "folder" | "hub" | "file";
export type RecentEntry = { kind: RecentKind; path: string; hub?: string; app?: string; at: number };
export const RECENT_MAX = 40;
const KINDS = new Set(["folder", "hub", "file"]);

function read(name: string): any {
  try { return JSON.parse(fs.readFileSync(path.join(paperboatHome(), name), "utf8")); } catch { return null; }
}
function write(name: string, value: unknown) {
  const f = path.join(paperboatHome(), name), tmp = `${f}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, f);
}

/** `recent.json`'s entries (a missing or broken file is none), as every app wrote them. */
export function recent(): RecentEntry[] {
  const list = read("recent.json")?.recent;
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && KINDS.has(e.kind) && typeof e.path === "string" && e.path && Number.isFinite(e.at)).slice(0, RECENT_MAX);
}

/** Puts one entry first (Julix opened it now): an older one of the same kind and path goes; 40 at most. */
export function remember(e: { kind: RecentKind; path: string; hub?: string }) {
  const rest = recent().filter((x) => x.kind !== e.kind || x.path !== e.path);
  const entry: RecentEntry = { kind: e.kind, path: e.path, ...(e.hub ? { hub: e.hub } : {}), app: "julix", at: Math.floor(Date.now() / 1000) };
  write("recent.json", { version: 1, recent: [entry, ...rest].slice(0, RECENT_MAX) });
}

/** Clear recent: the list is shared, so it is cleared for every app. */
export const forget = () => write("recent.json", { version: 1, recent: [] });

/** `settings.json`: the theme ("system" when unset) and the scale (1 when unset); other keys another app wrote are kept on write. */
export function settings(): { version: 1; theme: Theme; scale: Scale } {
  const s = read("settings.json");
  return { version: 1, theme: s?.theme === "light" || s?.theme === "dark" ? s.theme : "system", scale: isScale(s?.scale) ? s.scale : 1 };
}
export function saveSettings(change: { theme?: Theme; scale?: Scale }) {
  const old = read("settings.json");
  write("settings.json", { ...(old && typeof old === "object" ? old : {}), ...change, version: 1 });
}
