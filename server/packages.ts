// The folder's Julia packages, the platform's way (paperboat CLI `add`/`remove`/`packages`): the folder is
// the Julia project; a short exec lease changes it, with the network (and a writable project) for that
// step only, and the packages land in the project's deps volume, which the session loads from. The page
// asks the user before an add opens the network.
import fs from "node:fs";
import path from "node:path";
import { Control, type Lease } from "./control.ts";
import { Folder } from "./folder.ts";

export type Package = { name: string; version: string };
export class PackageError extends Error {}

const SAFE = /^[A-Za-z0-9._+-]+$/;
const JULIXPLOT = { name: "JulixPlot", url: "https://github.com/paperboatlab/JulixPlot.jl", rev: "main" };

/** Whether the folder's project lists JulixPlot (Julix adds it before the first session).
 * ponytail: reads Project.toml only; a deps volume wiped under a listed JulixPlot needs Packages › add again. */
export function hasJulixPlot(root: string): boolean {
  try { return /^\s*JulixPlot\s*=/m.test(fs.readFileSync(path.join(root, "Project.toml"), "utf8")); } catch { return false; }
}

/** The Julia code for one step; it lists the direct dependencies after, and says it finished. */
export function recipe(op: "list" | "add" | "remove", name = "", local = false): { code: string; network: boolean; writable: boolean } {
  if (op !== "list" && !SAFE.test(name)) throw new PackageError("a package name is letters, digits and . _ + -");
  let body = 'import Pkg; Pkg.activate(ENV["PAPERBOAT_PROJECT"]; io=devnull); ';
  if (op === "add") body += name !== JULIXPLOT.name ? `Pkg.add("${name}"); `
    : local ? `Pkg.develop(path=joinpath(ENV["PAPERBOAT_PROJECT"], ".julix", "JulixPlot.jl")); `   // a checkout ($JULIXPLOT), copied into the folder
    : `Pkg.add(Pkg.PackageSpec(url="${JULIXPLOT.url}", rev="${JULIXPLOT.rev}")); `;   // not registered yet: from its repository
  if (op === "remove") body += `Pkg.offline(true); Pkg.rm("${name}"); `;
  body += 'for p in values(Pkg.dependencies()); p.is_direct_dep && println("PKG ", p.name, " ", something(p.version, "")); end; println("JULIX-DONE")';
  return { code: body, network: op === "add", writable: op !== "list" };
}

export function parse(log: string): { packages: Package[]; done: boolean } {
  const packages: Package[] = [];
  for (const line of log.split("\n")) {
    const m = /^PKG (\S+) ?(\S*)$/.exec(line.trim());
    if (m) packages.push({ name: m[1], version: m[2] });
  }
  return { packages: packages.sort((a, b) => a.name.localeCompare(b.name)), done: /^JULIX-DONE$/m.test(log) };
}

export async function packages(control: Control, folder: Folder, op: "list" | "add" | "remove", name?: string): Promise<{ packages: Package[]; log: string }> {
  // a JulixPlot checkout to develop (JULIXPLOT=<path>): the container sees only the folder, so it is copied in
  const checkout = op === "add" && name === JULIXPLOT.name ? process.env.JULIXPLOT : undefined;
  if (checkout) {
    const dest = path.join(folder.root, ".julix", "JulixPlot.jl");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(checkout, dest, { recursive: true, filter: (src) => !src.split(path.sep).includes(".git") });
  }
  const r = recipe(op, name, !!checkout);
  const lease = await control.call<Lease>("acquire", {
    runtime: "julia", mode: "exec", project: folder.root, owner: `julix:${folder.root}:packages`,
    command: ["julia", "--startup-file=no", "-e", r.code],
    policy: { ...(r.network ? { network: true } : {}), ...(r.writable ? { writable_project: true } : {}) },
  });
  try {
    for (let state = lease.state; state !== "exited" && state !== "failed";) {   // ponytail: polls; the lease events when Control fans them out
      await new Promise((z) => setTimeout(z, 400));
      state = (await control.call<Lease[]>("ps")).find((l) => l.id === lease.id)?.state ?? "exited";
    }
    const { text } = await control.call<{ text: string }>("logs", { lease: lease.id, tail: 4000 });
    const out = parse(text);
    if (!out.done) throw new PackageError(`Julia's package manager stopped:\n${text.slice(-1500)}`);
    return { packages: out.packages, log: text };
  } finally {
    control.call("release", { lease: lease.id }).catch(() => {});
  }
}
