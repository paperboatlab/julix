import assert from "node:assert/strict";
import { test } from "node:test";
import { cellAt, cells } from "../client/cells.ts";
import { atLine } from "../server/session.ts";
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
