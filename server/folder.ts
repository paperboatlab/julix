// The workspace: the folder Julix opens. The files are the record; `.julix/` holds what Julix keeps
// (figures, the trash) and can be deleted. Every path from the page goes through `resolve`, which keeps
// it inside the folder. The examples are not here: they open from Ctrl K (server/hubs.ts, `paperboat example`).
// An example opened in place is read-only (server/examples.ts): `locked` says which paths are an example's, and
// every write there is refused; what Julix keeps for it (figures) goes to `data`, a scratch folder outside it.
import fs from "node:fs";
import path from "node:path";

export type Entry = { path: string; name: string; kind: "dir" | "file"; size?: number; mtime?: number; children?: Entry[] };
export class FolderError extends Error { readonly status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

const HIDDEN = new Set([".julix", ".git", "node_modules", ".DS_Store"]);

/** An absolute path for `rel` inside `root`, or an error if it (or a symlink in it) leaves the root. */
export function inside(root: string, rel: string): string {
  if (typeof rel !== "string" || rel.includes("\0")) throw new FolderError("bad path");
  const abs = path.resolve(root, rel.replace(/^\/+/, ""));
  const ok = (p: string) => p === root || p.startsWith(root + path.sep);
  if (!ok(abs)) throw new FolderError("outside the folder");
  let real = abs;   // a symlink may point out: check where it really lands (the last part may not exist yet)
  try { real = fs.realpathSync(abs); } catch { try { real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { /* a new folder chain */ } }
  if (!ok(real)) throw new FolderError("outside the folder");
  return abs;
}

function walk(root: string, dir: string): Entry[] {
  const out: Entry[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN.has(d.name) || d.name.startsWith(".")) continue;
    const abs = path.join(dir, d.name), rel = path.relative(root, abs).split(path.sep).join("/");
    if (d.isDirectory()) out.push({ path: rel, name: d.name, kind: "dir", children: walk(root, abs) });
    else if (d.isFile()) { const st = fs.statSync(abs); out.push({ path: rel, name: d.name, kind: "file", size: st.size, mtime: st.mtimeMs }); }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "dir" ? -1 : 1));
}

/** A write refused: the path is an example's (copy it to change it). */
export const EXAMPLE_LOCKED = "is an example and can't be changed: copy it (the banner's Copy) to change it";

export class Folder {
  readonly root: string;
  readonly name: string;
  /** The whole folder is an example's: nothing in it is written. */
  readonly readOnly: boolean;
  /** Where Julix keeps what it makes (figures, the trash): `.julix/`, or a scratch folder for an example. */
  readonly data: string;
  private locked: (abs: string) => boolean;

  /** `locked`: whether an absolute path is an example's (none: nothing is); `scratch`: an example's data folder. */
  constructor(root: string, opts: { locked?: (abs: string) => boolean; scratch?: (root: string) => string } = {}) {
    this.root = fs.realpathSync(root);
    this.name = path.basename(this.root);
    this.locked = opts.locked ?? (() => false);
    this.readOnly = this.locked(this.root);
    this.data = this.readOnly && opts.scratch ? opts.scratch(this.root) : path.join(this.root, ".julix");
  }

  /** The absolute path of a workspace path. */
  resolve(rel: string): string { return inside(this.root, rel); }

  /** The absolute path of a workspace path to write: refused (403) when it is an example's. */
  writable(rel: string): string {
    const abs = this.resolve(rel);
    if (this.readOnly || this.locked(abs)) throw new FolderError(`${rel || this.name} ${EXAMPLE_LOCKED}`, 403);
    return abs;
  }

  tree(): Entry[] { return walk(this.root, this.root); }

  read(rel: string): string {
    const abs = this.resolve(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new FolderError(`${rel} not found`, 404);
    return fs.readFileSync(abs, "utf8");
  }

  /** Writes a file whole (atomic: a reader never sees half of it). */
  write(rel: string, text: string) {
    const abs = this.writable(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, abs);
  }

  /** A new file; a free name (`-2`, `-3`…) if this one is taken. Returns its path. */
  create(rel: string, text = ""): string {
    const ext = path.posix.extname(rel), base = rel.slice(0, rel.length - ext.length);
    let p = rel;
    for (let n = 2; fs.existsSync(this.writable(p)); n++) p = `${base}-${n}${ext}`;
    const abs = this.writable(p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, { flag: "wx" });
    return p;
  }

  mkdir(rel: string) { fs.mkdirSync(this.writable(rel), { recursive: true }); }

  rename(from: string, to: string) {
    const a = this.writable(from), b = this.writable(to);
    if (a === this.root) throw new FolderError("the folder itself can't move");
    if (fs.existsSync(b)) throw new FolderError(`${to} exists`, 409);
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.renameSync(a, b);
  }

  /** Copies a file to a new one in the folder (Duplicate); returns the new path. */
  copyIn(from: string, to: string): string { this.writable(to); return this.create(to, this.read(from)); }

  /** Move to trash: into `.julix/trash/<time>/`, so it can come back. */
  trash(rel: string) {
    const abs = this.writable(rel);
    if (abs === this.root) throw new FolderError("the folder itself can't go to the trash");
    const dest = path.join(this.data, "trash", new Date().toISOString().replace(/[:.]/g, "-"), rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(abs, dest);
  }
}
