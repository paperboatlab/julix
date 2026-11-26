// Julix's shared variables (server/share.ts, Sessions.shared): what the eval prints becomes paperboat/0 variables,
// and the running stations are found from the records the engine keeps.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseShared } from "../server/session.ts";
import { stations } from "../server/share.ts";

test("the eval's lines become variables: numbers, booleans, text, matrices by rows, a big one with a note", () => {
  const text = "k\tn\t2.5\nflag\tb\ttrue\nname\tt\tcart pole\nA\tm\t1.0 2.0; 3.0 4.0\nbig\tbig\t100×100\t10000\n\n";
  assert.deepEqual(parseShared(text), [
    { name: "k", type: "number", value: 2.5 },
    { name: "flag", type: "boolean", value: true },
    { name: "name", type: "text", value: "cart pole" },
    { name: "A", type: "matrix", value: "1.0 2.0; 3.0 4.0" },
    { name: "big", type: "matrix", note: "100×100: too large to share live (10000 values, limit 4096); share a slice such as big[1:10, 1:10]" },
  ]);
  assert.deepEqual(parseShared(""), []);
});

test("running stations come from the engine's records; a dead one is left out", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "julix-records-"));
  fs.writeFileSync(path.join(dir, "station-51301.json"), JSON.stringify({ pid: process.pid, port: 51301, ws_url: "ws://localhost:51301" }));
  fs.writeFileSync(path.join(dir, "station-51302.json"), JSON.stringify({ pid: 2 ** 22 + 1, port: 51302 }));   // no such process
  fs.writeFileSync(path.join(dir, "station-51303.json"), "{ half written");
  fs.writeFileSync(path.join(dir, "smoke-1.log"), "");
  assert.deepEqual(stations(dir), ["ws://127.0.0.1:51301"]);
  assert.deepEqual(stations(path.join(dir, "none")), []);
});
