// Unicode through the editor's server: a file with non-ASCII and astral text, a BOM and CRLF, opened over HTTP,
// edited and saved back byte for byte; a file whose name isn't ASCII. (The editor's own typing, Tab and
// offsets are the kit's tests: paperboat-ui test/editor/unicode.test.ts.)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serve } from "../server/main.ts";

test("a UTF-8 script round-trips: non-ASCII and astral text, a BOM, CRLF, a name that isn't ASCII", { skip: process.platform === "win32" }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-uni-")));
  const dir = path.join(tmp, "Modèles");
  fs.mkdirSync(dir);
  const text = '﻿α = 1\r\nprintln("héllo 中文 😀 👩‍🔬 x̂", α)\r\n';
  fs.writeFileSync(path.join(dir, "θ.jl"), text);
  const env = process.env.PAPERBOAT_HOME;
  process.env.PAPERBOAT_HOME = path.join(tmp, "pbhome");
  const { server, ready } = serve(dir, 0);
  try {
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json() };
    };
    await ready;
    assert.deepEqual((await call("GET", "/api/tree")).json.files.map((f: { path: string }) => f.path), ["θ.jl"]);
    const opened = (await call("GET", `/api/file?path=${encodeURIComponent("θ.jl")}`)).json;
    assert.equal(opened.text, text, "read as it is: the BOM and the CRLFs kept");
    const edited = `${opened.text}β = "∑ 😄"\r\n`;
    assert.equal((await call("PUT", `/api/file?path=${encodeURIComponent("θ.jl")}`, { text: edited })).status, 200);
    assert.deepEqual(fs.readFileSync(path.join(dir, "θ.jl")), Buffer.from(edited, "utf8"), "the bytes on disk");
    assert.equal((await call("POST", "/api/new", { path: "naïve 😀.jl", text: "ü = 1\n" })).json.path, "naïve 😀.jl");
    assert.equal(fs.readFileSync(path.join(dir, "naïve 😀.jl"), "utf8"), "ü = 1\n");
  } finally {
    server.close();
    if (env === undefined) delete process.env.PAPERBOAT_HOME; else process.env.PAPERBOAT_HOME = env;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
