import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { bump, live, requestRefresh } from "../server/live.ts";

let server: Server;
let origin: string;
before(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/refresh" && request.method === "POST")
        response.end(JSON.stringify(bump(JSON.parse(body).page)));
      else response.writeHead(404).end(JSON.stringify({ error: "Unknown endpoint." }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test("a refresh request bumps the counter that open pages poll", async () => {
  const { instance, refresh, reload } = live;
  assert.equal(await requestRefresh(false, origin), true);
  assert.deepEqual(live, { instance, refresh: refresh + 1, reload });
  assert.equal(await requestRefresh(true, origin), true);
  assert.deepEqual(live, { instance, refresh: refresh + 1, reload: reload + 1 });
});

test("a CLI can tell a missing server from a refused request", async () => {
  assert.equal(await requestRefresh(false, "http://127.0.0.1:1"), false);
  await assert.rejects(requestRefresh(false, `${origin}/missing`), /Unknown endpoint/);
});
