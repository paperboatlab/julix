// JulixPlot comes with Julix: added to the folder's Julia project before its first session, the platform's
// way (the CLI's `package add` recipe): a short exec lease with the network (and a writable project) for that
// step only; it lands in the project's deps volume, which the session loads from. Every other package is
// managed in Paperboat Launcher › Runtimes › julia › Packages (`paperboat package add julia …`).
import fs from "node:fs";
import path from "node:path";
import { Control, type Lease } from "./control.ts";
import { Folder } from "./folder.ts";

export type Package = { name: string; version: string };
export class PackageError extends Error {}

const JULIXPLOT = { url: "https://github.com/paperboatlab/JulixPlot.jl", rev: "main" };

/** Whether the folder's project lists JulixPlot.
 * ponytail: reads Project.toml only; a deps volume wiped under a listed JulixPlot needs the Launcher's Packages › add again. */
export function hasJulixPlot(root: string): boolean {
  try { return /^\s*JulixPlot\s*=/m.test(fs.readFileSync(path.join(root, "Project.toml"), "utf8")); } catch { return false; }
}

/** The Julia code that adds JulixPlot (not registered yet: from its repository, or a local checkout copied into
 * the folder), then lists the direct dependencies and says it finished. */
export function recipe(local = false): string {
  return 'import Pkg; Pkg.activate(ENV["PAPERBOAT_PROJECT"]; io=devnull); '
    + (local ? 'Pkg.develop(path=joinpath(ENV["PAPERBOAT_PROJECT"], ".julix", "JulixPlot.jl")); '
      : `Pkg.add(Pkg.PackageSpec(url="${JULIXPLOT.url}", rev="${JULIXPLOT.rev}")); `)
    + 'for p in values(Pkg.dependencies()); p.is_direct_dep && println("PKG ", p.name, " ", something(p.version, "")); end; println("JULIX-DONE")';
}

export function parse(log: string): { packages: Package[]; done: boolean } {
  const packages: Package[] = [];
  for (const line of log.split("\n")) {
    const m = /^PKG (\S+) ?(\S*)$/.exec(line.trim());
    if (m) packages.push({ name: m[1], version: m[2] });
  }
  return { packages: packages.sort((a, b) => a.name.localeCompare(b.name)), done: /^JULIX-DONE$/m.test(log) };
}

export async function addJulixPlot(control: Control, folder: Folder): Promise<Package[]> {
  // a JulixPlot checkout to develop (JULIXPLOT=<path>): the container sees only the folder, so it is copied in
  const checkout = process.env.JULIXPLOT;
  if (checkout) {
    const dest = path.join(folder.root, ".julix", "JulixPlot.jl");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(checkout, dest, { recursive: true, filter: (src) => !src.split(path.sep).includes(".git") });
  }
  const lease = await control.call<Lease>("acquire", {
    runtime: "julia", mode: "exec", project: folder.root, owner: `julix:${folder.root}:packages`,
    command: ["julia", "--startup-file=no", "-e", recipe(!!checkout)],
    policy: { network: true, writable_project: true },
  });
  try {
    for (let state = lease.state; state !== "exited" && state !== "failed";) {   // ponytail: polls; the lease events when Control fans them out
      await new Promise((z) => setTimeout(z, 400));
      state = (await control.call<Lease[]>("ps")).find((l) => l.id === lease.id)?.state ?? "exited";
    }
    const { text } = await control.call<{ text: string }>("logs", { lease: lease.id, tail: 4000 });
    const out = parse(text);
    if (!out.done) throw new PackageError(`Julia's package manager stopped:\n${text.slice(-1500)}`);
    return out.packages;
  } finally {
    control.call("release", { lease: lease.id }).catch(() => {});
  }
}
