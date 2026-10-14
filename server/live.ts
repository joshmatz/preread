import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

// Open pages remember the instance they first saw and reload the app when it changes.
export const instance = randomUUID();
export const origin = `http://127.0.0.1:${process.env.PORT || 4780}`;
const pages = new Set<ServerResponse>();
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
export function subscribe(response: ServerResponse) {
  response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
  response.write(`retry: 1000\n${frame("hello", { instance })}`);
  pages.add(response);
  response.on("close", () => pages.delete(response));
}
export function broadcast(event: string, data: unknown) {
  const message = frame(event, data);
  for (const page of pages) page.write(message);
  return pages.size;
}
// For CLIs. Returns how many open pages a running server refreshed, or null without a server.
export async function requestRefresh(page: boolean, server = origin): Promise<number | null> {
  let response: Response;
  try {
    response = await fetch(`${server}/api/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
    });
  } catch {
    return null;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not refresh the open review pages.");
  return data.pages;
}
