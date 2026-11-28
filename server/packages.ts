// Before a folder's first session its packages are made ready, the platform's way (the CLI's `package add`
// recipe): a short exec lease with the network for that step only; they land in the folder's deps volume
// (paperboatd keeps one per runtime and project path), which the session loads from. JulixPlot comes with
// Julix: added when Project.toml doesn't list it (a writable project). A Manifest whose packages the deps
// volume lacks (an example, a copied or moved folder, a fresh install) is instantiated, with the project
// left read-only: the Manifest stays as it is. Every other package is managed in Paperboat Launcher ›
// Runtimes › julia › Packages (`paperboat package add julia …`).
import fs from "node:fs";
import path from "node:path";
import { Control, type Lease } from "./control.ts";
import { Folder } from "./folder.ts";

export type Package = { name: string; version: string };
export class PackageError extends Error {}

const JULIXPLOT = { url: "https://github.com/paperboatlab/JulixPlot.jl", rev: "main" };

/** Whether the folder's project lists JulixPlot (whether it is installed is `missing`'s question). */
export function hasJulixPlot(root: string): boolean {
  try { return /^\s*JulixPlot\s*=/m.test(fs.readFileSync(path.join(root, "Project.toml"), "utf8")); } catch { return false; }
}

const LIST = 'for p in values(Pkg.dependencies()); p.is_direct_dep && println("PKG ", p.name, " ", something(p.version, "")); end; println("JULIX-DONE")';

/** The Julia code that adds JulixPlot (not registered yet: from its repository, or a local checkout copied into
 * the folder), then lists the direct dependencies and says it finished. */
export function recipe(local = false): string {
  return 'import Pkg; Pkg.activate(ENV["PAPERBOAT_PROJECT"]; io=devnull); '
    + (local ? 'Pkg.develop(path=joinpath(ENV["PAPERBOAT_PROJECT"], ".julix", "JulixPlot.jl")); '
      : `Pkg.add(Pkg.PackageSpec(url="${JULIXPLOT.url}", rev="${JULIXPLOT.rev}")); `)
    + LIST;
}

/** The Julia code that installs what the folder's Manifest records, then lists and says it finished. */
export const INSTANTIATE = 'import Pkg; Pkg.activate(ENV["PAPERBOAT_PROJECT"]; io=devnull); Pkg.instantiate(); ' + LIST;

export function parse(log: string): { packages: Package[]; done: boolean } {
  const packages: Package[] = [];
  for (const line of log.split("\n")) {
    const m = /^PKG (\S+) ?(\S*)$/.exec(line.trim());
    if (m) packages.push({ name: m[1], version: m[2] });
  }
  return { packages: packages.sort((a, b) => a.name.localeCompare(b.name)), done: /^JULIX-DONE$/m.test(log) };
}

/** The packages a Manifest.toml records from a registry or a repository (not the standard library's, nor a
 * developed path's): their name, uuid and tree hash. */
export function recorded(manifest: string): { name: string; uuid: string; tree: string }[] {
  const out: { name: string; uuid: string; tree: string }[] = [];
  for (const block of manifest.split(/^(?=\[\[)/m)) {
    const name = /^\[\[(?:deps\.)?("?)([^"\]]+)\1\]\]/.exec(block)?.[2];
    const uuid = /^\s*uuid\s*=\s*"([0-9a-f-]{36})"/m.exec(block)?.[1];
    const tree = /^\s*git-tree-sha1\s*=\s*"([0-9a-f]{40})"/m.exec(block)?.[1];
    if (name && uuid && tree && !/^\s*path\s*=/m.test(block)) out.push({ name, uuid, tree });
  }
  return out;
}

// Pkg's folder for a version, `packages/<name>/<slug>`: Base.version_slug, five base-62 digits of the crc32c of
// the uuid (a UInt128's bytes, little-endian) and then the tree hash
const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? (n >>> 1) ^ 0x82f63b78 : n >>> 1; return n >>> 0; });
const crc32c = (bytes: Buffer, crc = 0) => { crc = ~crc >>> 0; for (const b of bytes) crc = CRC[(crc ^ b) & 0xff] ^ (crc >>> 8); return ~crc >>> 0; };
export function slug(uuid: string, tree: string): string {
  let y = crc32c(Buffer.from(tree, "hex"), crc32c(Buffer.from(uuid.replace(/-/g, ""), "hex").reverse()));
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 5; i++) { s += chars[y % 62]; y = Math.floor(y / 62); }
  return s;
}

/** The packages the folder's Manifest records that the deps volume (its host folder, or null: none yet) lacks. */
export function missing(root: string, deps: string | null): string[] {
  let manifest: string;
  try { manifest = fs.readFileSync(path.join(root, "Manifest.toml"), "utf8"); } catch { return []; }
  return recorded(manifest).filter((p) => !deps || !fs.existsSync(path.join(deps, "packages", p.name, slug(p.uuid, p.tree)))).map((p) => p.name);
}

/** The folder's julia deps volume on the host, or null while it doesn't exist (paperboatd makes it on a first lease). */
export async function depsVolume(control: Control, root: string): Promise<string | null> {
  const [list, volumes] = await Promise.all([
    control.call<{ runtimes: { name: string; version: string; modes: string[] }[] }>("runtimes.list"),
    control.call<{ runtime: string; project: string; path: string; exists: boolean }[]>("volumes"),
  ]);
  const julia = list.runtimes.find((r) => r.name === "julia" && r.modes.includes("session"));
  const name = julia && `julia-${julia.version.split(".").slice(0, 2).join("-")}`;
  return volumes.find((v) => v.runtime === name && v.project === root && v.exists)?.path ?? null;
}

/** Instantiates the folder's Manifest into its deps volume; `progress` gets Pkg's latest line. */
export function instantiate(control: Control, folder: Folder, progress?: (line: string) => void): Promise<Package[]> {
  return exec(control, folder, INSTANTIATE, { network: true }, progress);
}

/** Adds JulixPlot to the folder's project (which installs the rest of its Manifest too). */
export async function addJulixPlot(control: Control, folder: Folder, progress?: (line: string) => void): Promise<Package[]> {
  // a JulixPlot checkout to develop (JULIXPLOT=<path>): the container sees only the folder, so it is copied in
  const checkout = process.env.JULIXPLOT;
  if (checkout) {
    const dest = path.join(folder.root, ".julix", "JulixPlot.jl");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(checkout, dest, { recursive: true, filter: (src) => !src.split(path.sep).includes(".git") });
  }
  return exec(control, folder, recipe(!!checkout), { network: true, writable_project: true }, progress);
}

/** The last line of Pkg's log worth showing ("Installed Cairo ─ v1.1.1", "Precompiling project…"). */
export function latest(log: string): string | undefined {
  return log.split(/[\r\n]/).map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim()).filter((l) => l && !/^(PKG |JULIX-DONE$)/.test(l)).at(-1);
}

async function exec(control: Control, folder: Folder, code: string, policy: Record<string, boolean>, progress?: (line: string) => void): Promise<Package[]> {
  const lease = await control.call<Lease>("acquire", {
    runtime: "julia", mode: "exec", project: folder.root, owner: `julix:${folder.root}:packages`,
    command: ["julia", "--startup-file=no", "-e", code], policy,
    ...(folder.readOnly && !policy.writable_project ? { readonly: true } : {}),   // an example's Manifest installs into the deps volume only
  });
  try {
    for (let state = lease.state, shown = ""; state !== "exited" && state !== "failed";) {   // ponytail: polls; the lease events when Control fans them out
      await new Promise((z) => setTimeout(z, 400));
      state = (await control.call<Lease[]>("ps")).find((l) => l.id === lease.id)?.state ?? "exited";
      if (progress) {
        const line = latest((await control.call<{ text: string }>("logs", { lease: lease.id, tail: 20 }).catch(() => ({ text: "" }))).text);
        if (line && line !== shown) progress(shown = line);
      }
    }
    const { text } = await control.call<{ text: string }>("logs", { lease: lease.id, tail: 4000 });
    const out = parse(text);
    if (!out.done) throw new PackageError(`Julia's package manager stopped:\n${text.slice(-1500)}`);
    return out.packages;
  } finally {
    control.call("release", { lease: lease.id }).catch(() => {});
  }
}
