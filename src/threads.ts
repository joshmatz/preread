import { z } from "zod";

const eventId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "A reply ID is a lowercase UUID.");
export const replyBody = z.string().max(12000, "Keep a reply under 12,000 characters.").refine((value) => !value.includes("\0"))
  .refine((value) => !!value.trim(), "Write a reply.");
export const threadEventSchema = z.strictObject({
  id: eventId, createdAt: z.iso.datetime(), author: z.enum(["person", "agent"]), body: replyBody.optional(), resolved: z.boolean(),
}).refine((event) => event.author === "person" || event.body !== undefined, "An agent resolves only with a reply.");
export type ThreadEvent = z.infer<typeof threadEventSchema>;
export type ThreadAuthor = ThreadEvent["author"];
export type Threads = Record<string, ThreadEvent[]>;
export const threadCommandSchemas = <T extends z.ZodType<string>>(entry: T) => [
  z.strictObject({ kind: z.literal("reply"), entry, id: eventId, body: replyBody }),
  z.strictObject({ kind: z.literal("resolve"), entry }),
  z.strictObject({ kind: z.literal("reopen"), entry }),
] as const;
export type ThreadCommand = { kind: "reply"; id: string; body: string } | { kind: "resolve" } | { kind: "reopen" };

export type ThreadRoot = { id: string; updatedAt: string };
// `turn` is whoever acts next: an edit to the root after the last reply counts as the person's latest word.
export type ThreadState = { turn: "agent" | "person"; changed: boolean } | { turn: "resolved"; by: ThreadAuthor; at: string };
export type ThreadTurn = ThreadState["turn"];
export const sortEvents = (events: ThreadEvent[]) => [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
export function threadState(root: Pick<ThreadRoot, "updatedAt">, events: ThreadEvent[] = []): ThreadState {
  const last = events.at(-1);
  if (!last) return { turn: "agent", changed: false };
  if (root.updatedAt > last.createdAt) return { turn: "agent", changed: true };
  if (last.resolved) return { turn: "resolved", by: last.author, at: last.createdAt };
  return { turn: last.author === "person" ? "agent" : "person", changed: false };
}
export type ThreadCounts = Record<ThreadTurn, number>;
export const noThreads = (): ThreadCounts => ({ agent: 0, person: 0, resolved: 0 });
export function threadCounts(roots: ThreadRoot[], threads: Threads = {}, counts = noThreads()) {
  for (const root of roots) counts[threadState(root, threads[root.id]).turn] += 1;
  return counts;
}
export const openThreads = (counts?: ThreadCounts) => (counts?.agent ?? 0) + (counts?.person ?? 0);

// Printed IDs are short: a UUID's first block, or an answer or approval ID with its revision cut to eight characters.
export function shortIds(ids: string[]) {
  const short = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id) ? id.slice(0, 8) : id.replace(/-([a-f0-9]{8})[a-f0-9]{56}$/, "-$1");
  return new Map(ids.map((id) => {
    const value = short(id);
    return [id, ids.some((other) => other !== id && other.startsWith(value)) ? id : value];
  }));
}
export const minimumIdLength = 8;
export const idMatches = (id: string, query: string) => id === query || (query.length >= minimumIdLength && id.startsWith(query));

// A printed ID ends in `.` and a stamp of the reader's last word, so a reply written before the reader's newest edit or reply is refused instead of resolving it unseen.
const readerActions = (root: Pick<ThreadRoot, "updatedAt">, events: ThreadEvent[]) =>
  [{ at: root.updatedAt, action: "changed this" }, ...events.filter((event) => event.author === "person")
    .map((event) => ({ at: event.createdAt, action: event.body !== undefined ? "replied" : event.resolved ? "resolved this" : "reopened this" }))];
const lastReaderAction = (root: Pick<ThreadRoot, "updatedAt">, events: ThreadEvent[] = []) =>
  readerActions(root, events).reduce((latest, entry) => entry.at > latest.at ? entry : latest);
export const readerStamp = (root: Pick<ThreadRoot, "updatedAt">, events?: ThreadEvent[]) =>
  Date.parse(lastReaderAction(root, events).at).toString(36).slice(-4);
export const replyId = (id: string, root: Pick<ThreadRoot, "updatedAt">, events?: ThreadEvent[]) => `${id}.${readerStamp(root, events)}`;
export function parseReplyId(value: string) {
  const [id, stamp, ...rest] = value.split(".");
  return rest.length || stamp === "" ? null : { id, stamp };
}
// What the reader did since `stamp`, or "" when nothing.
export const readerChange = (stamp: string, root: Pick<ThreadRoot, "updatedAt">, events?: ThreadEvent[]) =>
  readerStamp(root, events) === stamp ? "" : lastReaderAction(root, events).action;

export function threadLines(root: Pick<ThreadRoot, "updatedAt">, events: ThreadEvent[] = []) {
  const name = (author: ThreadAuthor) => author === "agent" ? "Agent" : "Reader";
  const lines = events.map((event) => event.body === undefined
    ? `${name(event.author)} ${event.resolved ? "resolved" : "reopened"} this.`
    : `${name(event.author)}${event.resolved ? " (resolved)" : ""}: ${event.body}`);
  const state = threadState(root, events);
  if (state.turn === "agent" && state.changed) lines.push("Reader changed this after the last reply.");
  return lines;
}
export const turnLabel = (state: ThreadState) => state.turn === "resolved" ? `resolved by the ${state.by === "agent" ? "agent" : "reader"}`
  : state.turn === "person" ? "waiting on the reader" : "";
