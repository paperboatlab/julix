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
});

test("the examples read, copy in, and refuse writes", () => {
  const ex = tmp();
  fs.writeFileSync(path.join(ex, "01.jl"), "a = 1\n");
  const f = new Folder(tmp(), ex);
  assert.deepEqual(f.exampleTree().map((e) => e.path), ["@examples/01.jl"]);
  assert.equal(f.read("@examples/01.jl"), "a = 1\n");
  for (const write of [() => f.write("@examples/01.jl", ""), () => f.trash("@examples/01.jl"), () => f.mkdir("@examples"), () => f.create("@examples/x.jl")])
    assert.throws(write, (e: FolderError) => e.status === 409);
  assert.throws(() => f.read("@examples/../../etc/passwd"), FolderError);
  assert.equal(f.copyIn("@examples/01.jl", "01.jl"), "01.jl");
  assert.equal(f.read("01.jl"), "a = 1\n");
});
