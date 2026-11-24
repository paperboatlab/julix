// The workspace tree with the examples under it, and the file menu (REBRAND "File menu": one right-click
// menu for files in every app, the same groups in the same order; the owning app adds one group under its
// name; an item that can't run stays, greyed, with why). Adapted from Malachite's client/Tree.tsx.
import { Icon, Menu, type MenuEntry } from "@paperboatlab/ui";
import { useState } from "react";
import type { Entry } from "./api.ts";
import { FileIcon, OWNER, typeOf } from "./files.tsx";

export type FileActions = {
  open: (p: string, side?: boolean) => void;
  run: (p: string) => void;
  newScript: (dir: string) => void;
  newFolder: (dir: string) => void;
  copyIn: (p: string) => void;
  rename: (p: string) => void;
  trash: (p: string) => void;
  copy: (text: string, what: string) => void;
  reveal: (p: string) => void;
};

const example = (p: string) => p === "@examples" || p.startsWith("@examples/");

export function fileMenu(e: Entry, a: FileActions): MenuEntry[] {
  const dir = e.kind === "dir", t = typeOf(e.path), owner = OWNER[t], ro = example(e.path);
  const items: MenuEntry[] = [];
  if (!dir) {
    items.push({ id: "open", label: "Open", shortcut: "Enter", run: () => a.open(e.path) });
    items.push({ id: "side", label: "Open to the side", shortcut: "Ctrl Enter", run: () => a.open(e.path, true) });
    if (owner && owner !== "Julix") items.push({ id: "in", label: `Open in ${owner}`, icon: "link-external", disabled: true, why: `${owner} isn't installed yet`, run: () => {} });
    if (t === "md") items.push({ id: "in", label: "Open in Malachite", icon: "link-external", disabled: true, why: "Malachite isn't connected to Julix yet", run: () => {} });
  } else if (!ro) {
    items.push({ id: "new", label: "New script here", shortcut: "Ctrl N", run: () => a.newScript(e.path) });
    items.push({ id: "folder", label: "New folder here", run: () => a.newFolder(e.path) });
  }
  if (t === "jl") {
    items.push("-", { note: "Julix" }, { id: "run", label: "Run", icon: "play", shortcut: "F5", run: () => a.run(e.path) });
    if (ro) items.push({ id: "copyin", label: "Copy to my folder", icon: "copy", run: () => a.copyIn(e.path) });
  }
  if (!ro) items.push("-", { id: "rename", label: "Rename…", shortcut: "F2", run: () => a.rename(e.path) });
  items.push("-", { id: "path", label: "Copy path", icon: "copy", run: () => a.copy(e.path, "Path") });
  if (!ro) items.push({ id: "reveal", label: "Reveal in file manager", run: () => a.reveal(e.path) });
  if (!ro) items.push("-", { id: "trash", label: "Move to trash", icon: "trash", shortcut: "Del", run: () => a.trash(e.path) });
  return items;
}

export function Tree({ entries, examples, current, open, onToggle, actions }: {
  entries: Entry[]; examples: Entry[]; current: string | null; open: Set<string>; onToggle: (p: string) => void; actions: FileActions;
}) {
  const [menu, setMenu] = useState<{ e: Entry; x: number; y: number } | null>(null);
  const rows: React.ReactNode[] = [];
  const row = (e: Entry, d: number, extra?: React.ReactNode, cls = "") => {
    const isOpen = open.has(e.path), dir = e.kind === "dir";
    const name = dir || !e.name.includes(".") ? e.name : e.name.slice(0, e.name.lastIndexOf("."));
    const ext = dir || !e.name.includes(".") ? "" : e.name.slice(e.name.lastIndexOf("."));
    rows.push(
      <div key={e.path} role="treeitem" aria-expanded={dir ? isOpen : undefined} aria-selected={e.path === current} tabIndex={-1}
        className={`tr${e.path === current || menu?.e.path === e.path ? " on" : ""}${cls}`} style={{ "--d": d } as React.CSSProperties}
        onClick={() => (dir ? onToggle(e.path) : actions.open(e.path))}
        onContextMenu={(ev) => { ev.preventDefault(); setMenu({ e, x: ev.clientX, y: ev.clientY }); }}
        onKeyDown={(ev) => { if (ev.key === "Enter") actions.open(e.path, ev.ctrlKey); if (ev.key === "F2") actions.rename(e.path); if (ev.key === "Delete") actions.trash(e.path); }}>
        {dir ? <span className="cv"><Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} /></span> : <span className="cv" />}
        <FileIcon path={e.path} dir={dir} open={isOpen} />
        <span className="nm">{name}<span className="x">{ext}</span></span>
        {extra ?? (dir && <small>{count(e)}</small>)}
      </div>,
    );
    if (dir && isOpen) for (const c of e.children ?? []) row(c, d + 1);
  };
  for (const e of entries) row(e, 0);
  if (examples.length) row({ path: "@examples", name: "Examples", kind: "dir", children: examples }, 0, <small>read-only</small>, " dim exh");
  return (
    <div className="tree" role="tree" aria-label="Files">
      {entries.length === 0 && <p className="none">No files yet: make a script (Ctrl N), or copy an example.</p>}
      {rows}
      {menu && (
        <div className="ctx" style={{ left: Math.min(menu.x, innerWidth - 290), top: Math.min(menu.y, innerHeight - 380) }}>
          <div className="mh"><FileIcon path={menu.e.path} dir={menu.e.kind === "dir"} size={14} />{menu.e.name}</div>
          <Menu label={`${menu.e.name}: actions`} items={fileMenu(menu.e, actions)} onClose={() => setMenu(null)} />
        </div>
      )}
    </div>
  );
}

const count = (e: Entry): number => (e.children ?? []).reduce((n, c) => n + (c.kind === "dir" ? count(c) : 1), 0);
