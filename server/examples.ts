// The examples are read-only where they are (paperboat#75): `paperboat example open` starts this server on the
// example's own folder (a paperboat-examples checkout, or GitHub's copy in $PAPERBOAT_HOME/cache/examples) and
// says so only in the page's URL, so the server finds out for itself. The examples' roots are
// $PAPERBOAT_EXAMPLES_DIR, the cache, and the folder every listed example sits in (`<root>/<group>/<example>`,
// its id being `<group>/<example>`). Nothing under a root is written: the Folder refuses it, a run goes on in
// a scratch copy, figures go to a scratch folder, and neither recent.json nor the hub list shows it.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { examples, type Example } from "./hubs.ts";
import { paperboatHome } from "./store.ts";

/** An example as a workspace says it: its id and name, and `cache` when changes there wouldn't be kept anyway. */
export type ExampleInfo = { id: string; name: string; cache: boolean };

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
export const within = (root: string, p: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** Where the examples are, and whether a path is one's. `load`: the examples the CLI lists (a test passes its own). */
export class Examples {
  private list: Example[] = [];
  /** The listed examples shaped as the CLI makes them: the ones a path can be. */
  private placed: Example[] = [];
  private roots: string[];
  private readonly cache: string;
  /** Settles once the CLI has answered (or failed): every root is known then. */
  readonly ready: Promise<void>;

  constructor(load: () => Promise<Example[]> = examples) {
    this.cache = real(path.join(paperboatHome(), "cache", "examples"));
    const env = process.env.PAPERBOAT_EXAMPLES_DIR;
    this.roots = [this.cache, ...(env ? [real(env)] : [])];
    this.ready = load().then((list) => {
      this.list = list;
      for (const e of list) {
        // only an entry shaped as the CLI makes it (<root>/<group>/<example>, id <group>/<example>) names a root
        const parts = e.path.split(/[\\/]/), id = e.id.split("/");
        if (id.length !== 2 || !path.isAbsolute(e.path) || parts.slice(-2).join("/") !== e.id) continue;
        this.placed.push(e);
        const root = real(path.dirname(path.dirname(e.path)));
        if (!this.roots.includes(root)) this.roots.push(root);
      }
    }, () => {});
  }

  /** The examples the CLI listed (Ctrl K's Open example:). */
  async all(): Promise<Example[]> { await this.ready; return this.list; }

  /** Whether `p` (absolute) is in the examples: never written. */
  locked(p: string): boolean { const r = real(p); return this.roots.some((root) => within(root, r)); }

  /** The example holding `p`: the listed one, else `<group>/<example>` under a root when it has an example.toml. */
  at(p: string): ExampleInfo | undefined {
    const r = real(p), root = this.roots.find((x) => within(x, r));
    if (!root) return undefined;
    const cache = root === this.cache;
    const listed = this.placed.find((e) => within(real(e.path), r));
    if (listed) return { id: listed.id, name: listed.name, cache };
    const id = path.relative(root, r).split(path.sep).slice(0, 2);
    if (id.length < 2 || !id[1]) return undefined;
    let name = id.join("/");
    try { name = /^name\s*=\s*"([^"]*)"/m.exec(fs.readFileSync(path.join(root, ...id, "example.toml"), "utf8"))?.[1] ?? name; } catch { return undefined; }
    return { id: id.join("/"), name, cache };
  }
}

/** Where an example's figures go: a scratch folder of its own, outside it. */
export const scratchFor = (root: string) =>
  path.join(os.tmpdir(), `julix-example-${process.getuid?.() ?? "u"}`, crypto.createHash("sha256").update(root).digest("hex").slice(0, 16));
