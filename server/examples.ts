// The examples are read-only where they are (paperboat#75, #85): `paperboat example open <id>` starts this server
// on the example's own folder (a paperboat-examples checkout, $PAPERBOAT_EXAMPLES_DIR, or GitHub's copy in
// $PAPERBOAT_HOME/cache/examples) with PAPERBOAT_EXAMPLE=<id> in its environment (paperboat docs/apps.md), so the
// server knows it is one even when the page's URL has no ?example=. The examples' roots are the `root` every entry
// of `example list --json` has; nothing under a root is written: the Folder refuses it, a run's lease is read-only
// (`"readonly": true`, enforced by paperboatd) and goes on in a scratch copy, figures go to a scratch folder, and
// neither recent.json nor the hub list shows it.
// A paperboat before v0.2.0-beta.9 says neither: then the roots are guessed as before ($PAPERBOAT_HOME/cache/examples,
// $PAPERBOAT_EXAMPLES_DIR, the folder every listed `<root>/<group>/<example>` sits in), and an example's id and name
// under a root come from its example.toml.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { examples, type Example } from "./hubs.ts";
import { paperboatHome } from "./store.ts";

/** An example as a workspace says it: its id and name, and `cache` when it is GitHub's copy in the cache. */
export type ExampleInfo = { id: string; name: string; cache: boolean };

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
export const within = (root: string, p: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const tomlName = (dir: string) => { try { return /^name\s*=\s*"([^"]*)"/m.exec(fs.readFileSync(path.join(dir, "example.toml"), "utf8"))?.[1]; } catch { return undefined; } };

/** Where the examples are, and whether a path is one's. `load`: the examples the CLI lists (a test passes its own).
 *  `opened`: the example this server was started for (`id`: $PAPERBOAT_EXAMPLE, `folder`: the folder it was started on). */
export class Examples {
  private list: Example[] = [];
  private roots: string[] = [];
  private readonly cache: string;
  private readonly opened?: { id: string; folder: string };
  /** Settles once the CLI has answered (or failed): every root is known then. */
  readonly ready: Promise<void>;
  /** Whether the roots are guessed (a CLI that says no `root`): example.toml then names an example under one. */
  private guessed = false;

  constructor(load: () => Promise<Example[]> = examples, opened: { id?: string; folder?: string | null } = {}) {
    this.cache = real(path.join(paperboatHome(), "cache", "examples"));
    if (opened.id && opened.folder) this.opened = { id: opened.id, folder: real(opened.folder) };
    const add = (root: string) => { const r = real(root); if (!this.roots.includes(r)) this.roots.push(r); };
    const guess = (list: Example[]) => {   // a paperboat before v0.2.0-beta.9, or none
      this.guessed = true;
      add(this.cache);
      if (process.env.PAPERBOAT_EXAMPLES_DIR) add(process.env.PAPERBOAT_EXAMPLES_DIR);
      for (const e of list) {   // only an entry shaped as the CLI makes it (<root>/<group>/<example>, id <group>/<example>) names one
        const parts = e.path.split(/[\\/]/), id = e.id.split("/");
        if (id.length === 2 && path.isAbsolute(e.path) && parts.slice(-2).join("/") === e.id) add(path.dirname(path.dirname(e.path)));
      }
    };
    this.ready = load().then((list) => {
      this.list = list;
      const said = list.filter((e) => e.root && path.isAbsolute(e.root));
      if (said.length) for (const e of said) add(e.root!); else guess(list);
    }, () => guess([]));
  }

  /** The examples the CLI listed (Ctrl K's Open example:). */
  async all(): Promise<Example[]> { await this.ready; return this.list; }

  /** Whether `p` (absolute) is in the examples: never written. */
  locked(p: string): boolean {
    const r = real(p);
    return (!!this.opened && within(this.opened.folder, r)) || this.roots.some((root) => within(root, r));
  }

  /** The example holding `p`: the one this server was started for, else the listed one, else (roots guessed)
   *  `<group>/<example>` under a root when it has an example.toml. */
  at(p: string): ExampleInfo | undefined {
    const r = real(p);
    const listed = (id: string) => this.list.find((e) => e.id === id);
    const cache = (dir: string) => within(this.cache, dir);
    if (this.opened && within(this.opened.folder, r)) {
      const { id, folder } = this.opened;
      return { id, name: listed(id)?.name ?? tomlName(folder) ?? id, cache: cache(folder) };
    }
    // a listed example in a root (an entry elsewhere, one an older CLI didn't place under a root, names nothing)
    const e = this.list.find((x) => { const d = path.isAbsolute(x.path) && real(x.path); return !!d && within(d, r) && this.roots.some((root) => within(root, d)); });
    if (e) return { id: e.id, name: e.name, cache: cache(real(e.path)) };
    const root = this.guessed && this.roots.find((x) => within(x, r));
    if (!root) return undefined;
    const id = path.relative(root, r).split(path.sep).slice(0, 2);
    if (id.length < 2 || !id[1]) return undefined;
    const name = tomlName(path.join(root, ...id));
    return name === undefined ? undefined : { id: id.join("/"), name: name || id.join("/"), cache: root === this.cache };
  }
}

/** Where an example's figures go: a scratch folder of its own, outside it. */
export const scratchFor = (root: string) =>
  path.join(os.tmpdir(), `julix-example-${process.getuid?.() ?? "u"}`, crypto.createHash("sha256").update(root).digest("hex").slice(0, 16));
