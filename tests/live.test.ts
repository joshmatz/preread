import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { broadcast, instance, requestRefresh, subscribe } from "../server/live.ts";

let server: Server;
let origin: string;
before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/api/events") return subscribe(response);
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/refresh" && request.method === "POST")
        response.end(JSON.stringify({ pages: broadcast("refresh", JSON.parse(body)) }));
      else response.writeHead(400).end(JSON.stringify({ error: "Unknown endpoint." }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
const until = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(condition());
};

test("open pages hear the server instance, then each refresh, until they disconnect", async () => {
  const abort = new AbortController();
  const response = await fetch(`${origin}/api/events`, { signal: abort.signal });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frame = async () => {
    while (!buffer.includes("\n\n")) buffer += decoder.decode((await reader.read()).value);
    const end = buffer.indexOf("\n\n") + 2;
    const next = buffer.slice(0, end);
    buffer = buffer.slice(end);
    return next;
  };
  assert.equal(await frame(), `retry: 1000\nevent: hello\ndata: {"instance":"${instance}"}\n\n`);
  assert.equal(await requestRefresh(false, origin), 1);
  assert.equal(await frame(), 'event: refresh\ndata: {"page":false}\n\n');
  assert.equal(await requestRefresh(true, origin), 1);
  assert.equal(await frame(), 'event: refresh\ndata: {"page":true}\n\n');
  abort.abort();
  await until(() => broadcast("refresh", { page: false }) === 0);
  assert.equal(await requestRefresh(false, origin), 0);
});

test("a CLI can tell a missing server from a refused request", async () => {
  assert.equal(await requestRefresh(false, "http://127.0.0.1:1"), null);
  await assert.rejects(requestRefresh(false, `${origin}/missing`), /Unknown endpoint/);
});
