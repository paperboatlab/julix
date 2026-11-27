// The one file workflow's server side: the workspace switched at runtime, a file from outside switching to its
// folder or hub, and the shared recent.json and settings.json under $PAPERBOAT_HOME.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serve } from "../server/main.ts";

test("open a folder, a hub, a file from outside, close; recent and settings shared", { skip: process.platform === "win32" }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-ws-")));
  const home = path.join(tmp, "pbhome"), a = path.join(tmp, "a"), b = path.join(tmp, "b"), hub = path.join(tmp, "hubs", "tank-lab");
  for (const d of [a, b, path.join(hub, "sub")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(b, "x.jl"), "1\n");
  fs.writeFileSync(path.join(hub, "sub", "fit.jl"), "2\n");
  fs.writeFileSync(path.join(hub, "one.jl"), "3\n");
  const cli = path.join(tmp, "paperboat");
  fs.writeFileSync(cli, `#!/bin/sh\necho '${JSON.stringify([{ id: "h1", name: "tank-lab", path: hub, shown: hub, place: "local" }])}'\n`, { mode: 0o755 });
  const env = { PAPERBOAT_HOME: process.env.PAPERBOAT_HOME, PAPERBOAT_BIN: process.env.PAPERBOAT_BIN };
  process.env.PAPERBOAT_HOME = home; process.env.PAPERBOAT_BIN = cli;
  const { server, ready } = serve(null, 0);
  try {
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json() };
    };
    await ready;
    assert.equal((await call("GET", "/api/workspace")).json.workspace, null);
    assert.equal((await call("GET", "/api/tree")).status, 409);   // nothing to show before a folder opens

    assert.deepEqual((await call("POST", "/api/workspace", { kind: "folder", path: a })).json, { kind: "folder", root: a, name: "a" });
    // a file from outside switches to its folder
    assert.deepEqual((await call("POST", "/api/open", { path: path.join(b, "x.jl") })).json, { workspace: { kind: "folder", root: b, name: "b" }, path: "x.jl" });
    // a file inside a known hub switches to the hub
    assert.deepEqual((await call("POST", "/api/open", { path: path.join(hub, "sub", "fit.jl") })).json,
      { workspace: { kind: "hub", root: hub, name: "tank-lab", hub: "h1" }, path: "sub/fit.jl" });
    // the hubs say what they hold
    assert.equal((await call("GET", "/api/hubs")).json[0].holds, "2 scripts");
    // a new file never goes over one; saving as writes it and opens it
    assert.equal((await call("POST", "/api/saveas", { path: path.join(b, "x.jl"), text: "", new: true })).status, 409);
    assert.equal((await call("POST", "/api/saveas", { path: path.join(b, "y.jl"), text: "4\n" })).json.path, "y.jl");
    assert.equal(fs.readFileSync(path.join(b, "y.jl"), "utf8"), "4\n");
    // Close: no workspace
    assert.equal((await call("POST", "/api/workspace", { kind: null })).json, null);

    // recent.json: newest first, one per (kind, path), the contract's shape
    const store = JSON.parse(fs.readFileSync(path.join(home, "recent.json"), "utf8"));
    assert.equal(store.version, 1);
    assert.deepEqual(store.recent.map((e: { kind: string; path: string; hub?: string }) => [e.kind, e.path, e.hub]), [
      ["file", path.join(b, "y.jl"), undefined], ["folder", b, undefined], ["file", path.join(hub, "sub", "fit.jl"), "h1"], ["hub", hub, "h1"],
      ["file", path.join(b, "x.jl"), undefined], ["folder", a, undefined],
    ]);
    assert.ok(store.recent.every((e: { app: string; at: number }) => e.app === "julix" && Number.isInteger(e.at)));
    await call("POST", "/api/recent/clear", {});
    assert.deepEqual((await call("GET", "/api/recent")).json, { version: 1, recent: [] });

    // settings.json: the theme, written back; another app's keys stay
    assert.equal((await call("GET", "/api/settings")).json.theme, "system");
    fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify({ version: 1, theme: "light", other: 1 }));
    assert.equal((await call("PUT", "/api/settings", { theme: "dark" })).json.theme, "dark");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8")), { version: 1, theme: "dark", other: 1 });
    // the scale beside it (1 when unset); an unknown one is refused
    assert.equal((await call("GET", "/api/settings")).json.scale, 1);
    assert.equal((await call("PUT", "/api/settings", { scale: 0.75 })).json.scale, 0.75);
    assert.equal((await call("PUT", "/api/settings", { scale: 2 })).status, 400);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8")), { version: 1, theme: "dark", other: 1, scale: 0.75 });
    assert.deepEqual(fs.readdirSync(home).sort(), ["recent.json", "settings.json"]);   // no temp file left
  } finally {
    server.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
