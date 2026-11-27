import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Folder, FolderError } from "../server/folder.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "julix-"));

test("paths stay in the folder, symlinks too", () => {
  const f = new Folder(tmp()), out = tmp();
  fs.symlinkSync(out, path.join(f.root, "link"));
  for (const p of ["../x.jl", "../../etc/passwd", "a/../../x", "link/x.jl", "bad\0"]) assert.throws(() => f.resolve(p), FolderError, p);
  assert.equal(f.resolve("a/b.jl"), path.join(f.root, "a", "b.jl"));
  assert.equal(f.resolve("/etc/passwd"), path.join(f.root, "etc", "passwd"));   // absolute means from the folder
});

test("write, create a free name, rename, trash", () => {
  const f = new Folder(tmp());
  assert.equal(f.create("s.jl", "1"), "s.jl");
  assert.equal(f.create("s.jl", "2"), "s-2.jl");
  f.write("s.jl", "x = 1\n");
  assert.equal(f.read("s.jl"), "x = 1\n");
  f.rename("s-2.jl", "sub/t.jl");
  assert.deepEqual(f.tree().map((e) => e.path), ["sub", "s.jl"]);
  f.trash("s.jl");
  assert.equal(fs.existsSync(path.join(f.root, "s.jl")), false);
  assert.equal(fs.readdirSync(path.join(f.root, ".julix", "trash")).length, 1);
  assert.deepEqual(f.tree().map((e) => e.path), ["sub"]);   // .julix stays out of the tree
  fs.mkdirSync(path.join(f.root, ".malachite"));
  fs.writeFileSync(path.join(f.root, ".malachite", "hub.toml"), "schema = 2\n");
  assert.deepEqual(f.tree().map((e) => e.path), ["sub"]);   // a hub's own files too
});

test("Duplicate copies a file to a free name", () => {
  const f = new Folder(tmp());
  f.write("01.jl", "a = 1\n");
  assert.equal(f.copyIn("01.jl", "01.jl"), "01-2.jl");
  assert.equal(f.read("01-2.jl"), "a = 1\n");
});
