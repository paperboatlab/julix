import assert from "node:assert/strict";
import { test } from "node:test";
import { around } from "../client/api.ts";

test("a completion sends the statement at the cursor, not the whole script", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const code = "x = 1\n".repeat(1000) + "function f(α)\n    y = α + 1\n    pri";
  const r = around(code, bytes(code))!;
  assert.equal(r.code, "function f(α)\n    y = α + 1\n    pri");
  assert.equal(r.skip + r.pos, bytes(code));   // the answer's offsets go back by `skip`
  const top = "x = 1\n".repeat(1000) + "pri";
  assert.equal(around(top, bytes(top))!.code, "pri");
  assert.equal(around("pri", 3), null);   // a small script goes whole
});
