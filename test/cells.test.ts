import assert from "node:assert/strict";
import { test } from "node:test";
import { cellAround, cellAt, cells, isHead } from "../client/cells.ts";
import { atLine, enter } from "../server/session.ts";
import { ours } from "../client/traceback.ts";

const text = "using LinearAlgebra\n\n## Build\nA = rand(3, 3)\n\n## Solve\nx = A \\ b\n##not a head\n";

test("cells run from a ## line to the next one; the lines before the first are a cell", () => {
  assert.deepEqual(cells(text), [{ from: 1, to: 2, title: "" }, { from: 3, to: 5, title: "Build" }, { from: 6, to: 9, title: "Solve" }]);
});

test("the cell at a line, and its code", () => {
  assert.equal(cellAt(text, 4)?.code, "## Build\nA = rand(3, 3)\n");
  assert.equal(cellAt(text, 4)?.index, 1);
  assert.equal(cellAt(text, 7)?.cell.title, "Solve");
  assert.equal(cellAt("", 1)?.code, undefined);
});

test("a file that starts with a cell head", () => {
  assert.deepEqual(cells("## One\na = 1\n## Two\nb = 2"), [{ from: 1, to: 2, title: "One" }, { from: 3, to: 4, title: "Two" }]);
});

test("code run from line n keeps its line numbers in tracebacks", () => {
  assert.equal(atLine("f(3)", 3), "\n\nf(3)");
  assert.equal(atLine("x", 1), "x");
});

test("a traceback stops at the user's top-level scope, as Julia's REPL", () => {
  const tb = "Stacktrace:\n  [1] error(s::String)\n    @ Base ./error.jl:35\n  [2] top-level scope\n    @ console:1\n  [3] eval\n    @ ./boot.jl:430 [inlined]";
  assert.equal(ours(tb), "Stacktrace:\n  [1] error(s::String)\n    @ Base ./error.jl:35\n  [2] top-level scope\n    @ console:1");
});

test("cellAround finds the cell cellAt finds, from the line out", () => {
  const texts = ["x = 1\ny = 2", "## A\nx = 1\n\n## B\ny = 2\n## \n\n## C\n", "a = 1\n## B\nb = 2\n##\n\nc = 3", "\n\n## Only\n", "## first\nx\n"];
  for (const t of texts) {
    const lines = t.split("\n");
    for (let n = 1; n <= lines.length; n++) {
      const want = cellAt(t, n)?.cell ?? null, got = cellAround((k) => lines[k - 1], lines.length, n);
      assert.deepEqual(got && { from: got.from, to: got.to, title: got.title }, lines.some(isHead) ? want : null, `${JSON.stringify(t)} line ${n}`);
    }
  }
});

test("a run enters its file's folder and gives its absolute path as the cell, so @__DIR__ is the file's own (#46)", () => {
  assert.match(enter("sub/deep/a.jl"), /; cd\(joinpath\(ENV\["PAPERBOAT_PROJECT"\], "sub\/deep"\)\); let p = joinpath\(pwd\(\), "a.jl"\); task_local_storage\(:SOURCE_PATH, p\); print\(p\); end$/);
  assert.match(enter("sub/deep/a.jl"), /^isdefined\(@__MODULE__, :include\) \|\| /);   // the session's namespace has no include of its own
  assert.match(enter("a.jl"), /; cd\(joinpath\(ENV\["PAPERBOAT_PROJECT"\], ""\)\); let p = joinpath\(pwd\(\), "a.jl"\)/);
  assert.match(enter("$x/a b.jl"), /"\\\$x"\)\).*"a b\.jl"/);
  // the console is a REPL: the folder's root, no file to include from
  assert.match(enter("console"), /; cd\(joinpath\(ENV\["PAPERBOAT_PROJECT"\], ""\)\); delete!\(task_local_storage\(\), :SOURCE_PATH\); nothing$/);
});
