import { randomUUID } from "node:crypto";

export const origin = `http://127.0.0.1:${process.env.PORT || 4780}`;
// A new instance on every start makes open pages reload, so a rebuilt client replaces the old one.
export const live = { instance: randomUUID(), refresh: 0, reload: 0 };
export function bump(page: boolean) {
  if (page) live.reload += 1;
  else live.refresh += 1;
  return live;
}
// For CLIs. Resolves false when no server is listening.
export async function requestRefresh(page: boolean, server = origin): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`${server}/api/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
    });
  } catch {
    return false;
  }
  if (response.ok) return true;
  const data = await response.json().catch(() => ({}));
  throw new Error(data.error || "Could not refresh the open review pages.");
}
