// Julix's shared variables (server/share.ts, Sessions.shared): what the eval prints becomes paperboat/0 variables,
// and the running stations are found from the records the engine keeps.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseShared } from "../server/session.ts";
import { Share, stations } from "../server/share.ts";

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

/** A WebSocket server just big enough for Share (text frames, masked from the client): what each connection sent. */
function station() {
  const got: unknown[][] = [];
  const server = http.createServer().on("upgrade", (req, socket) => {
    const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const mine: unknown[] = [];
    got.push(mine);
    let buf = Buffer.alloc(0);
    socket.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 0x7f, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + 4 + len) return;
        const mask = buf.subarray(at, at + 4), body = Buffer.from(buf.subarray(at + 4, at + 4 + len).map((b, i) => b ^ mask[i % 4]));
        if ((buf[0] & 0x0f) === 1) mine.push(JSON.parse(body.toString("utf8")));
        if ((buf[0] & 0x0f) === 8) socket.end();
        buf = buf.subarray(at + 4 + len);
      }
    });
    socket.on("error", () => {});
  });
  return { server, got, url: new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`))) };
}

test("a Julix with nothing to share sends a station nothing; one that shared takes its list back (julix#44)", async () => {
  const st = station(), url = await st.url;
  const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f()); };
  const empty = new Share(() => [url]), mine = new Share(() => [url]);
  try {
    await until(() => st.got.length === 2);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(st.got, [[], []]);   // each opened with nothing to share: no empty list over another's
    const k = { name: "k", type: "number" as const, value: 2.5 };
    mine.changed(async () => [k]);
    empty.changed(async () => []);   // a run that left no variables, in the other window
    await until(() => st.got.some((g) => g.length === 1));
    const [ours] = st.got.filter((g) => g.length);
    assert.deepEqual(ours, [{ type: "variables.set", source: "julix", variables: [k] }]);
    mine.changed(async () => []);   // its session restarted: the station hears it, to drop k
    await until(() => ours.length === 2);
    assert.deepEqual(ours[1], { type: "variables.set", source: "julix", variables: [] });
    assert.equal(st.got.flat().length, 2);
  } finally {
    empty.close(); mine.close();
    st.server.close();
    st.server.closeAllConnections?.();
  }
});

test("a station that resets, isn't one, or never answers leaves the server up (julix#51)", async () => {
  const reset = net.createServer((s) => s.resetAndDestroy()), notWs = http.createServer((_, r) => { r.writeHead(404); r.end(); });
  const silent = net.createServer(() => {});
  const urls = await Promise.all([reset, notWs, silent].map((s) => new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`ws://127.0.0.1:${(s.address() as AddressInfo).port}`)))));
  const crashed: unknown[] = [];
  const onCrash = (e: unknown) => crashed.push(e);
  process.on("uncaughtException", onCrash);
  const share = new Share(() => urls);
  try {
    await new Promise((r) => setTimeout(r, 1000));
    assert.deepEqual(crashed.map(String), []);
    assert.equal(share.count, 0);
  } finally {
    process.off("uncaughtException", onCrash);
    share.close();
    for (const s of [reset, notWs, silent]) { s.close(); (s as http.Server).closeAllConnections?.(); }
  }
});
