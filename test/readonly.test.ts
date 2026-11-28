// An example opened in place is read-only (paperboat#75): the server knows it from where the examples are (the CLI's
// list, $PAPERBOAT_EXAMPLES_DIR, the cache), refuses every write in it, keeps it out of recent.json and the hub
// list, and its banner's Copy makes a normal folder. Its checkout stays as git has it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Examples, scratchFor } from "../server/examples.ts";
import { Folder, FolderError } from "../server/folder.ts";
import { enter } from "../server/session.ts";
import { serve } from "../server/main.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
/** A paperboat-examples checkout with one Julix example and one hub, committed. */
function checkout(tmp: string) {
  const root = path.join(tmp, "paperboat-examples"), ex = path.join(root, "julix", "01-numerics"), hub = path.join(root, "hubs", "lab");
  fs.mkdirSync(path.join(ex, "sub"), { recursive: true });
  fs.mkdirSync(hub, { recursive: true });
  fs.writeFileSync(path.join(ex, "example.toml"), 'kind = "julix"\napp = "julix"\nname = "01 Numerics"\n');
  fs.writeFileSync(path.join(ex, "main.jl"), 'mkpath("out"); write("out/r.txt", "1")\n');
  fs.writeFileSync(path.join(ex, "sub", "b.jl"), "b = 2\n");
  fs.writeFileSync(path.join(hub, "example.toml"), 'kind = "hub"\nname = "Lab"\n');
  git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-qm", "examples");
  return { root, ex, hub };
}

test("a Folder refuses every write to an example's path, and keeps its data outside it", () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-ro-")));
  try {
    const { root, ex } = checkout(tmp);
    const locked = (p: string) => p === root || p.startsWith(root + path.sep);
    const f = new Folder(ex, { locked, scratch: scratchFor });
    assert.equal(f.readOnly, true);
    assert.ok(!f.data.startsWith(root), f.data);   // figures and the like: a scratch folder
    assert.equal(f.read("main.jl"), 'mkpath("out"); write("out/r.txt", "1")\n');   // read as ever
    const refused = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof FolderError && e.status === 403 && /copy it/.test(e.message));
    refused(() => f.write("main.jl", "x"));
    refused(() => f.write("new.jl", "x"));
    refused(() => f.create("new.jl", "x"));
    refused(() => f.mkdir("d"));
    refused(() => f.rename("main.jl", "m.jl"));
    refused(() => f.rename("sub/b.jl", "b.jl"));
    refused(() => f.copyIn("main.jl", "main.jl"));
    refused(() => f.trash("main.jl"));
    assert.equal(git(root, "status", "--porcelain", "--ignored"), "");

    // a folder that holds the examples (here: tmp) writes beside them, never into them
    const outer = new Folder(tmp, { locked, scratch: scratchFor });
    assert.equal(outer.readOnly, false);
    assert.equal(outer.data, path.join(tmp, ".julix"));
    outer.write("mine.jl", "1\n");
    refused(() => outer.write("paperboat-examples/julix/01-numerics/main.jl", "x"));
    refused(() => outer.rename("mine.jl", "paperboat-examples/mine.jl"));
    refused(() => outer.rename("paperboat-examples/julix/01-numerics/main.jl", "stolen.jl"));
    refused(() => outer.trash("paperboat-examples"));
    assert.equal(git(root, "status", "--porcelain", "--ignored"), "");

    // a run's folder in an example is in the session's own copy of it
    assert.match(enter("sub/main.jl", true), /JULIX_SCRATCH.*mktempdir\(\).*cp\(ENV\["PAPERBOAT_PROJECT"\], d\).*"sub"/);
    assert.match(enter("sub/main.jl"), /; cd\(joinpath\(ENV\["PAPERBOAT_PROJECT"\], "sub"\)\)/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("where the examples are: the CLI's list, $PAPERBOAT_EXAMPLES_DIR, the cache", async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-ro-")));
  const env = { PAPERBOAT_HOME: process.env.PAPERBOAT_HOME, PAPERBOAT_EXAMPLES_DIR: process.env.PAPERBOAT_EXAMPLES_DIR };
  try {
    const { root, ex } = checkout(tmp);
    process.env.PAPERBOAT_HOME = path.join(tmp, "home"); delete process.env.PAPERBOAT_EXAMPLES_DIR;
    const cached = path.join(tmp, "home", "cache", "examples", "julix", "02-notebook");
    fs.mkdirSync(cached, { recursive: true });
    fs.writeFileSync(path.join(cached, "example.toml"), 'name = "02 Notebook"\n');
    const listed = new Examples(async () => [{ id: "julix/01-numerics", app: "julix", kind: "julix", name: "01 Numerics", description: "", path: ex },
      { id: "h1", app: "malachite", kind: "hub", name: "not an example's shape", description: "", path: tmp }]);
    await listed.ready;
    assert.equal(listed.locked(ex), true);
    assert.equal(listed.locked(path.join(ex, "sub", "b.jl")), true);
    assert.equal(listed.locked(root), true);
    assert.equal(listed.locked(tmp), false);   // only a <root>/<group>/<example> entry names a root
    assert.deepEqual(listed.at(path.join(ex, "sub")), { id: "julix/01-numerics", name: "01 Numerics", cache: false });
    assert.deepEqual(listed.at(cached), { id: "julix/02-notebook", name: "02 Notebook", cache: true });   // the cache: always
    // no CLI: $PAPERBOAT_EXAMPLES_DIR, and a folder there with an example.toml is one
    process.env.PAPERBOAT_EXAMPLES_DIR = root;
    const bare = new Examples(async () => { throw new Error("no paperboat"); });
    await bare.ready;
    assert.equal(bare.locked(ex), true);
    assert.deepEqual(bare.at(ex), { id: "julix/01-numerics", name: "01 Numerics", cache: false });
    assert.equal(bare.locked(path.join(tmp, "elsewhere")), false);
  } finally {
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the server: an example opened in place takes no write, stays out of recent and hubs; its Copy is a normal folder", { skip: process.platform === "win32" }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-ro-")));
  const { root, ex, hub } = checkout(tmp);
  const home = path.join(tmp, "home"), work = path.join(tmp, "work"), mine = path.join(tmp, "my-hub"), cli = path.join(tmp, "paperboat");
  fs.mkdirSync(work); fs.mkdirSync(mine);
  const ENTRY = { id: "julix/01-numerics", app: "julix", kind: "julix", name: "01 Numerics", description: "", path: ex };
  fs.writeFileSync(cli, `#!/bin/sh
case "$*" in
  "example list --app julix --json") echo '${JSON.stringify([ENTRY])}' ;;
  "hub list --json") echo '${JSON.stringify([{ id: "ex", name: "Lab", path: hub, shown: hub, place: "local" }, { id: "h1", name: "my-hub", path: mine, shown: mine, place: "local" }])}' ;;
  "example copy julix/01-numerics --to ${work} --open --json") cp -r ${ex} ${work}/01-numerics && echo '${JSON.stringify({ ...ENTRY, path: path.join(work, "01-numerics") })}' ;;
  *) echo '{"error": "no"}'; exit 2 ;;
esac
`, { mode: 0o755 });
  const env = { PAPERBOAT_HOME: process.env.PAPERBOAT_HOME, PAPERBOAT_BIN: process.env.PAPERBOAT_BIN, PAPERBOAT_EXAMPLES_DIR: process.env.PAPERBOAT_EXAMPLES_DIR };
  process.env.PAPERBOAT_HOME = home; process.env.PAPERBOAT_BIN = cli; delete process.env.PAPERBOAT_EXAMPLES_DIR;
  // an example another app put in recent.json before is not shown
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "recent.json"), JSON.stringify({ version: 1, recent: [{ kind: "folder", path: ex, app: "malachite", at: 1 }, { kind: "hub", path: hub, hub: "ex", at: 2 }] }));
  const { server, ready } = serve(ex, 0);   // as `paperboat example open` starts it: on the example's folder
  try {
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json() };
    };
    await ready;
    assert.deepEqual((await call("GET", "/api/workspace")).json.workspace,
      { kind: "folder", root: ex, name: "01 Numerics", readOnly: true, example: { id: "julix/01-numerics", name: "01 Numerics", cache: false } });
    assert.equal((await call("GET", "/api/file?path=main.jl")).status, 200);
    for (const [method, url, body] of [
      ["PUT", "/api/file?path=main.jl", { text: "x" }], ["PUT", "/api/file?path=new.jl", { text: "x" }],
      ["POST", "/api/new", { path: "new.jl", text: "" }], ["POST", "/api/mkdir", { path: "d" }],
      ["POST", "/api/move", { from: "main.jl", to: "m.jl" }], ["POST", "/api/copy", { from: "main.jl", to: "main.jl" }],
      ["POST", "/api/trash", { path: "sub/b.jl" }],
      ["POST", "/api/saveas", { path: path.join(ex, "main.jl"), text: "x" }], ["POST", "/api/saveas", { path: path.join(ex, "sub", "c.jl"), text: "x", new: true }],
      ["POST", "/api/saveas", { path: path.join(root, "julix", "99.jl"), text: "x" }],
      ["POST", "/api/examples/copy", { id: "julix/01-numerics", to: path.join(root, "julix") }],
    ] as const) {
      const r = await call(method, url, body);
      assert.equal(r.status, 403, `${method} ${url} ${JSON.stringify(body)}: ${JSON.stringify(r.json)}`);
      assert.match(r.json.error, /is an example and can't be changed: copy it/);
    }
    // nowhere in recent.json, the recent list or the hubs
    assert.equal((await call("POST", "/api/recent", { path: "main.jl" })).status, 200);
    assert.equal((await call("POST", "/api/open", { path: path.join(ex, "sub", "b.jl") })).status, 200);
    const kept = JSON.parse(fs.readFileSync(path.join(home, "recent.json"), "utf8")).recent.map((e: { path: string }) => e.path);
    assert.deepEqual(kept, [ex, hub]);   // what was there stays; nothing of this window was added
    assert.deepEqual((await call("GET", "/api/recent")).json.recent, []);
    assert.deepEqual((await call("GET", "/api/hubs")).json.map((h: { id: string }) => h.id), ["h1"]);
    assert.equal((await call("POST", "/api/workspace", { kind: "hub", id: "ex" })).status, 404);
    assert.equal(git(root, "status", "--porcelain", "--ignored"), "");

    // the banner's Copy: a normal folder, written, remembered
    assert.equal((await call("POST", "/api/examples/copy", { id: "julix/01-numerics", to: work })).status, 200);
    const copy = path.join(work, "01-numerics");
    assert.deepEqual((await call("POST", "/api/workspace", { kind: "folder", path: copy })).json, { kind: "folder", root: copy, name: "01-numerics" });
    assert.equal((await call("PUT", "/api/file?path=main.jl", { text: "x = 1\n" })).status, 200);
    assert.equal((await call("POST", "/api/new", { path: "new.jl", text: "" })).status, 200);
    assert.equal(fs.readFileSync(path.join(copy, "main.jl"), "utf8"), "x = 1\n");
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "recent.json"), "utf8")).recent[0].path, copy);
    // and the example opened as a folder again is read-only again
    assert.equal((await call("POST", "/api/workspace", { kind: "folder", path: ex })).json.readOnly, true);
    assert.equal(git(root, "status", "--porcelain", "--ignored"), "");
  } finally {
    server.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
