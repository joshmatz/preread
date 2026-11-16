import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sortEvents, threadEventSchema, threadState, type ThreadCommand, type ThreadEvent, type ThreadRoot, type Threads } from "../src/threads.ts";

// Each reply or resolution is its own file under `<store>/threads/<entry>/`, so the reader's tab and an agent's CLI never overwrite each other.
const entryName = /^[a-z0-9][a-z0-9-]{0,159}$/;
const eventFile = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const threadDirectory = (store: string, entry: string) => {
  if (!entryName.test(entry)) throw new Error("That is not a feedback ID.");
  return join(store, "threads", entry);
};
async function readThread(store: string, entry: string) {
  const directory = threadDirectory(store, entry);
  const names = await readdir(directory).catch((error) => { if (missing(error)) return []; throw error; });
  const events = await Promise.all(names.filter((name) => eventFile.test(name)).map(async (name) => {
    try {
      const event = threadEventSchema.parse(JSON.parse(await readFile(join(directory, name), "utf8")));
      if (`${event.id}.json` !== name) throw new Error("This reply does not match its file name.");
      return event;
    } catch (error) {
      if (missing(error)) return null;
      console.warn(`Skipped reply ${name} on ${entry}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }));
  return sortEvents(events.filter((event) => event !== null));
}
export async function readThreads(store: string, entries: string[]): Promise<Threads> {
  const present = new Set(await readdir(join(store, "threads")).catch((error) => { if (missing(error)) return []; throw error; }));
  const threads = await Promise.all(entries.filter((entry) => present.has(entry)).map(async (entry) => [entry, await readThread(store, entry)] as const));
  return Object.fromEntries(threads.filter(([, events]) => events.length));
}
export const removeThread = (store: string, entry: string) => rm(threadDirectory(store, entry), { recursive: true, force: true });
// State follows timestamps, so an edit must land after the thread's last event even if the clock stepped back.
export async function editedAt(store: string, entry: string) {
  const events = await readThread(store, entry);
  return new Date(Math.max(Date.now(), ...events.map((event) => Date.parse(event.createdAt) + 1))).toISOString();
}

// One write at a time per thread in this process, so two tabs resolving at once add one event.
const queues = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, task: () => Promise<T>) {
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = run.catch(() => {});
  queues.set(key, settled);
  try { return await run; } finally { if (queues.get(key) === settled) queues.delete(key); }
}
const rootExists = (store: string, entry: string) => access(join(store, `${entry}.json`)).then(() => true, (error) => { if (missing(error)) return false; throw error; });
// Returns false when the root was removed meanwhile; its thread goes with it, whichever write finished last.
async function append(store: string, root: ThreadRoot, events: ThreadEvent[], event: Omit<ThreadEvent, "createdAt">) {
  const after = Math.max(Date.parse(root.updatedAt), ...events.map((entry) => Date.parse(entry.createdAt))) + 1;
  const value = threadEventSchema.parse({ ...event, createdAt: new Date(Math.max(Date.now(), after)).toISOString() });
  const directory = threadDirectory(store, root.id);
  const file = join(directory, `${value.id}.json`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) { if (!missing(error) || await rootExists(store, root.id)) throw error; }
  if (await rootExists(store, root.id)) return true;
  await removeThread(store, root.id);
  return false;
}
// The person's commands repeat safely: a reply keeps the ID its page chose, and resolving a resolved thread changes nothing.
export const personCommand = (store: string, root: ThreadRoot, command: ThreadCommand) => serial(threadDirectory(store, root.id), async () => {
  const events = await readThread(store, root.id);
  if (command.kind === "reply")
    return events.some((event) => event.id === command.id)
      || append(store, root, events, { id: command.id, author: "person", body: command.body.trim(), resolved: false });
  const resolved = threadState(root, events).turn === "resolved";
  return (command.kind === "resolve") === resolved
    || append(store, root, events, { id: randomUUID(), author: "person", resolved: command.kind === "resolve" });
});
export const agentReply = (store: string, root: ThreadRoot, body: string, resolve: boolean) => serial(threadDirectory(store, root.id), async () =>
  append(store, root, await readThread(store, root.id), { id: randomUUID(), author: "agent", body: body.trim(), resolved: resolve }));
