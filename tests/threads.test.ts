import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { briefSnapshot, saveBriefFeedback } from "../server/briefs.ts";
import { codeComments, saveCodeComment } from "../server/code-comments.ts";
import { putCollection } from "../server/collections.ts";
import { feedbackJson, feedbackText, replyAsAgent } from "../server/feedback.ts";
import { agentReply } from "../server/threads.ts";
import { idMatches, readerStamp, shortIds, threadLines, threadState, type ThreadEvent } from "../src/threads.ts";
import type { BriefBlock } from "../src/brief-types.ts";
import type { Collection } from "../src/review-types.ts";

let directory = "";
before(async () => { directory = await mkdtemp(join(tmpdir(), "preread-threads-")); process.env.PREREAD_DATA_DIR = join(directory, "data"); });
after(async () => { delete process.env.PREREAD_DATA_DIR; await rm(directory, { recursive: true, force: true }); });

const question: BriefBlock = { id: "rollout", kind: "question", question: "Ship it first?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] };
const approval: BriefBlock = { id: "check", kind: "code", language: "ts", code: "check(user)", approval: true };
const collection = (id: string): Collection => ({
  id, title: "Saved filters", description: "", brief: { blocks: [question] },
  reviews: [
    { id: "api", title: "Store filters", description: "", path: join(directory, "repository"), base: "main", mode: "branch", brief: { blocks: [question, approval] },
      groups: [{ id: "schema", title: "Schema", description: "", targets: [{ path: "src/schema.ts" }] }] },
    { id: "ui", title: "Show saved filters", description: "", path: join(directory, "repository"), base: "main", mode: "branch",
      groups: [{ id: "menu", title: "Menu", description: "", targets: [{ path: "src/menu.tsx" }] }] },
  ],
});
const comment = async (id: string, body: string) => {
  const commentId = randomUUID();
  await saveCodeComment(id, "ui", { kind: "save", id: commentId, group: "menu", path: "src/menu.tsx", line: { side: "new", number: 3, text: "open()" }, body });
  return commentId;
};
const event = (fields: Partial<ThreadEvent> & Pick<ThreadEvent, "author" | "resolved">, minute: number): ThreadEvent =>
  ({ id: randomUUID(), createdAt: `2026-11-16T10:${String(minute).padStart(2, "0")}:00.000Z`, ...fields });

test("whoever spoke last decides whose turn it is, and an edit to the root hands it back to the agent", () => {
  const root = { updatedAt: "2026-11-16T10:00:00.000Z" };
  assert.deepEqual(threadState(root), { turn: "agent", changed: false });
  const answered = [event({ author: "agent", body: "Yes, it is indexed.", resolved: false }, 1)];
  assert.equal(threadState(root, answered).turn, "person");
  assert.deepEqual(threadState(root, [...answered, event({ author: "person", resolved: true }, 2)]), { turn: "resolved", by: "person", at: "2026-11-16T10:02:00.000Z" });
  const fixed = [event({ author: "agent", body: "Renamed it.", resolved: true }, 1)];
  assert.equal(threadState(root, fixed).turn, "resolved");
  assert.equal(threadState(root, [...fixed, event({ author: "person", resolved: false }, 2)]).turn, "agent");
  assert.equal(threadState(root, [...fixed, event({ author: "person", body: "Also the test?", resolved: false }, 2)]).turn, "agent");
  assert.deepEqual(threadState({ updatedAt: "2026-11-16T10:05:00.000Z" }, fixed), { turn: "agent", changed: true });
  assert.deepEqual(threadLines({ updatedAt: "2026-11-16T10:05:00.000Z" }, [...answered, event({ author: "person", resolved: true }, 2)]),
    ["Agent: Yes, it is indexed.", "Reader resolved this.", "Reader changed this after the last reply."]);
});
test("printed IDs are short and unique, and a reply finds its item by any unique prefix of eight characters or more", () => {
  const uuid = "3f2a9c10-1111-4111-8111-111111111111", twin = "3f2a9c10-2222-4222-8222-222222222222";
  const answer = `answer-rollout-${"ab".repeat(32)}`;
  const ids = shortIds([uuid, "9e8d7c6b-3333-4333-8333-333333333333", answer]);
  assert.equal(ids.get("9e8d7c6b-3333-4333-8333-333333333333"), "9e8d7c6b");
  assert.equal(ids.get(answer), "answer-rollout-abababab");
  assert.equal(ids.get(uuid), "3f2a9c10");
  assert.equal(shortIds([uuid, twin]).get(uuid), uuid);
  assert.ok(idMatches(answer, "answer-rollout-abababab"));
  assert.ok(idMatches(uuid, "3f2a9c10"));
  assert.ok(!idMatches(uuid, "3f2a9c1"), "seven characters are too few");
});
test("the reader replies, resolves and reopens a code comment; repeats change nothing and removing it removes its thread", async () => {
  const id = "threads-code";
  await putCollection(collection(id));
  const root = await comment(id, "Is this query fast enough?");
  const replyId = randomUUID();
  const replied = await saveCodeComment(id, "ui", { kind: "reply", entry: root, id: replyId, body: "  With 3,000 contacts?  " });
  assert.deepEqual(replied.threads[root].map((entry) => [entry.author, entry.body, entry.resolved]), [["person", "With 3,000 contacts?", false]]);
  await saveCodeComment(id, "ui", { kind: "reply", entry: root, id: replyId, body: "With 3,000 contacts?" });
  await saveCodeComment(id, "ui", { kind: "resolve", entry: root });
  const resolved = await saveCodeComment(id, "ui", { kind: "resolve", entry: root });
  assert.equal(resolved.threads[root].length, 2);
  assert.equal(threadState(resolved.comments[0], resolved.threads[root]).turn, "resolved");
  assert.equal((await saveCodeComment(id, "ui", { kind: "reopen", entry: root })).threads[root].length, 3);
  assert.equal((await saveCodeComment(id, "ui", { kind: "reopen", entry: root })).threads[root].length, 3);
  const folder = join(directory, "data", "code-comments", id, "ui", "threads", root);
  assert.equal((await stat(folder)).mode & 0o777, 0o700);
  assert.equal((await stat(join(folder, `${replyId}.json`))).mode & 0o777, 0o600);
  await assert.rejects(saveCodeComment(id, "ui", { kind: "reply", entry: randomUUID(), id: randomUUID(), body: "Hello?" }), /was removed/);
  await assert.rejects(saveCodeComment(id, "ui", { kind: "reply", entry: root, id: randomUUID(), body: "  " }), /Write a reply/);
  await saveCodeComment(id, "ui", { kind: "delete", id: root });
  await assert.rejects(stat(folder), { code: "ENOENT" });
});
test("saving a comment unchanged keeps it resolved; changing it hands it back to the agent", async () => {
  const id = "threads-edits";
  await putCollection(collection(id));
  const root = await comment(id, "Rename this.");
  await replyAsAgent(id, [{ id: root, body: "Renamed it to openMenu.", resolve: true }]);
  const save = (body: string) => saveCodeComment(id, "ui", { kind: "save", id: root, group: "menu", path: "src/menu.tsx", line: { side: "new", number: 3, text: "open()" }, body });
  const same = await save("Rename this.");
  assert.equal(threadState(same.comments[0], same.threads[root]).turn, "resolved");
  const changed = await save("Rename this, and its test.");
  assert.deepEqual(threadState(changed.comments[0], changed.threads[root]), { turn: "agent", changed: true });
});
test("an agent replies by short ID, resolves only with a reply, and a batch with one bad reply writes nothing", async () => {
  const id = "threads-agent";
  await putCollection(collection(id));
  const root = await comment(id, "Why remove this?");
  const other = await comment(id, "Split this file.");
  const written = await replyAsAgent(id, [{ id: root.slice(0, 8), body: "It moved to menu.ts." }, { id: other, body: "Split into two files.", resolve: true }]);
  assert.deepEqual(written.map((entry) => [entry.id, entry.place, entry.resolved]),
    [[root.slice(0, 8), "Show saved filters: src/menu.tsx:3", false], [other.slice(0, 8), "Show saved filters: src/menu.tsx:3", true]]);
  const { comments, threads } = await codeComments(id, "ui");
  const states = Object.fromEntries(comments.map((entry) => [entry.id, threadState(entry, threads[entry.id]).turn]));
  assert.deepEqual(states, { [root]: "person", [other]: "resolved" });
  await assert.rejects(replyAsAgent(id, [{ id: root, body: "Fine." }, { id: "ffffffff", body: "Nobody." }]), /^Error: ffffffff: no feedback in threads-agent has this ID\. pnpm feedback threads-agent --all prints every ID\.\nNothing was sent\.$/);
  await assert.rejects(replyAsAgent(id, [{ id: root, body: "   ", resolve: true }]), /Write a reply/);
  await assert.rejects(replyAsAgent(id, [{ id: root, body: "Wrong part.", review: "api" }]), /: no feedback in threads-agent has this ID/);
  await assert.rejects(replyAsAgent(id, [{ id: root, body: "Missing part.", review: "missing" }]), /no review “missing”/);
  assert.equal((await codeComments(id, "ui")).threads[root].length, 1, "nothing from the failed batches was written");
});
test("overview answers and approvals are threads; a changed answer reopens one and removing an approval removes its thread", async () => {
  const id = "threads-brief";
  await putCollection(collection(id));
  const api = await briefSnapshot(id, "api");
  const answer = { kind: "answer", block: "rollout", revision: api.fingerprints.rollout, answer: { kind: "option", option: "no" } };
  const answered = await saveBriefFeedback(id, answer, "api");
  const answerId = answered.feedback[0].id;
  await replyAsAgent(id, [{ id: answerId, body: "Kept it behind the API.", resolve: true }]);
  const again = await saveBriefFeedback(id, answer, "api");
  assert.equal(threadState(again.feedback[0], again.threads[answerId]).turn, "resolved", "the same answer leaves it resolved");
  const changed = await saveBriefFeedback(id, { ...answer, answer: { kind: "option", option: "yes" } }, "api");
  assert.equal(threadState(changed.feedback[0], changed.threads[answerId]).turn, "agent");
  const approved = await saveBriefFeedback(id, { kind: "approve", block: "check", revision: api.fingerprints.check, approved: true }, "api");
  const approvalId = approved.feedback.find((entry) => entry.kind === "approval")!.id;
  await saveBriefFeedback(id, { kind: "resolve", entry: approvalId }, "api");
  assert.equal((await saveBriefFeedback(id, { kind: "approve", block: "check", revision: api.fingerprints.check, approved: true }, "api")).threads[approvalId].length, 1);
  await saveBriefFeedback(id, { kind: "approve", block: "check", revision: api.fingerprints.check, approved: false }, "api");
  await assert.rejects(stat(join(directory, "data", "brief-feedback", id, "reviews", "api", "threads", approvalId)), { code: "ENOENT" });
  const commentId = randomUUID();
  await saveBriefFeedback(id, { kind: "comment", id: commentId, body: "Who opens these?", anchor: { kind: "document", revision: api.version, title: "Store filters" } }, "api");
  await saveBriefFeedback(id, { kind: "reply", entry: commentId, id: randomUUID(), body: "Only the owner, I think." }, "api");
  await assert.rejects(saveBriefFeedback(id, { kind: "resolve", entry: "answer-missing" }, "api"), /was removed/);
  const snapshot = await briefSnapshot(id);
  assert.deepEqual(snapshot.attention?.reviews.api.threads, { agent: 2, person: 0, resolved: 0 });
  await comment(id, "Focus the first item.");
  await replyAsAgent(id, [{ id: commentId, body: "Owners only; sharing comes later." }]);
  const later = await briefSnapshot(id, "api");
  assert.deepEqual(later.attention?.reviews.api.threads, { agent: 1, person: 1, resolved: 0 });
  assert.deepEqual(later.attention?.code, { ui: { agent: 1, person: 0, resolved: 0 } });
});
test("feedback prints only what waits on the agent, with each thread's history; --all prints the rest with its state", async () => {
  const id = "threads-export";
  await putCollection(collection(id));
  const feature = await briefSnapshot(id);
  await saveBriefFeedback(id, { kind: "answer", block: "rollout", revision: feature.fingerprints.rollout, answer: { kind: "custom", text: "After the API." } });
  const waiting = await comment(id, "Is this fast enough?");
  const handled = await comment(id, "Rename this.");
  const asked = await comment(id, "Why here?");
  await replyAsAgent(id, [{ id: waiting, body: "Yes: it uses the contacts index." }, { id: handled, body: "Renamed.", resolve: true }, { id: asked, body: "It shares the query." }]);
  await saveCodeComment(id, "ui", { kind: "reply", entry: waiting, id: randomUUID(), body: "With 3,000 contacts?" });
  const { text, counts, shown } = await feedbackText(id);
  assert.deepEqual(counts, { agent: 2, person: 1, resolved: 1 });
  assert.equal(shown, 2);
  assert.match(text, /^Feature: Saved filters\nBrief revision: [a-f0-9]{64}\n\n1\. answer: Ship it first\?\nID: answer-rollout-[a-f0-9]{8}\.[a-z0-9]{4}\nAfter the API\.\n\nReview: Show saved filters\n\nCode comments:\n\n/);
  const stored = await codeComments(id, "ui");
  const stamp = readerStamp(stored.comments.find((entry) => entry.id === waiting)!, stored.threads[waiting]);
  assert.ok(text.includes(`1. src/menu.tsx:3\nID: ${waiting.slice(0, 8)}.${stamp}\nGroup: Menu\nLine: open()\nIs this fast enough?\nAgent: Yes: it uses the contacts index.\nReader: With 3,000 contacts?\n\n`));
  assert.doesNotMatch(text, /Rename this|Why here/);
  assert.match(text, /\n\nNothing waiting on the agent in review: Store filters\nNot shown: 1 waiting on the reader, 1 resolved; pnpm feedback threads-export --all prints them\.\nReply to an item with pnpm feedback reply threads-export <ID> "<reply>", adding --resolve once it is handled\.$/);
  const all = (await feedbackText(id, { all: true })).text;
  assert.match(all, /\[resolved by the agent\]\nID: [a-f0-9]{8}\.[a-z0-9]{4}\nGroup: Menu\nLine: open\(\)\nRename this\.\nAgent \(resolved\): Renamed\./);
  assert.match(all, /\[waiting on the reader\]\nID: [a-f0-9]{8}\.[a-z0-9]{4}\nGroup: Menu\nLine: open\(\)\nWhy here\?\nAgent: It shares the query\./);
  assert.match(all, /\nNo feedback on review: Store filters\nReply to an item/);
  assert.match((await feedbackText(id, { review: "ui" })).text, /\nNot shown: 1 waiting on the reader, 1 resolved; pnpm feedback threads-export --review ui --all prints them\./);
  assert.match((await feedbackText(id, { checkout: "/Users/me/Preread checkout" })).text, /with pnpm --dir '\/Users\/me\/Preread checkout' feedback reply threads-export <ID>/);
  const json = await feedbackJson(id);
  assert.deepEqual(json.threads, counts);
  assert.equal(json.feedback?.[0].thread.turn, "agent");
  assert.equal(json.reviews[1].codeComments[0].replyId, `${waiting.slice(0, 8)}.${stamp}`);
  assert.equal(json.reviews[1].codeComments[0].thread.changed, false);
  assert.deepEqual(json.reviews.map((entry) => [entry.review, entry.codeComments.map((item) => [item.id, item.thread.turn, item.thread.events.length])]),
    [["api", []], ["ui", [[waiting, "agent", 2]]]]);
  assert.equal((await feedbackJson(id, { all: true })).reviews[1].codeComments.length, 3);
  await replyAsAgent(id, [{ id: waiting, body: "Yes, measured at 40 ms.", resolve: true }, { id: `answer-rollout-${feature.fingerprints.rollout.slice(0, 8)}`, body: "Shipping after the API.", resolve: true }]);
  assert.match((await feedbackText(id)).text, /^Feature: Saved filters\n\nNothing is waiting on the agent\.\nNot shown: 1 waiting on the reader, 3 resolved; /);
});
test("tabs resolving at once add one event, and a reply to a removed comment leaves no thread behind", async () => {
  const id = "threads-races";
  await putCollection(collection(id));
  const root = await comment(id, "Check the empty state.");
  await Promise.all(Array.from({ length: 6 }, () => saveCodeComment(id, "ui", { kind: "resolve", entry: root })));
  assert.equal((await codeComments(id, "ui")).threads[root].length, 1);
  const store = join(directory, "data", "code-comments", id, "ui");
  const gone = { id: randomUUID(), updatedAt: new Date().toISOString() };
  assert.equal(await agentReply(store, gone, "Fixed.", true), false);
  await assert.rejects(stat(join(store, "threads", gone.id)), { code: "ENOENT" });
});
test("an edit lands after the last reply even when that reply is stamped ahead of the clock", async () => {
  const id = "threads-clock";
  await putCollection(collection(id));
  const root = await comment(id, "Rename this.");
  const folder = join(directory, "data", "code-comments", id, "ui", "threads", root);
  await mkdir(folder, { recursive: true });
  const ahead = event({ author: "agent", body: "Renamed.", resolved: true }, 0);
  ahead.createdAt = new Date(Date.now() + 60_000).toISOString();
  await writeFile(join(folder, `${ahead.id}.json`), JSON.stringify(ahead));
  const changed = await saveCodeComment(id, "ui", { kind: "save", id: root, group: "menu", path: "src/menu.tsx", line: { side: "new", number: 3, text: "open()" }, body: "Rename this and its test." });
  assert.deepEqual(threadState(changed.comments[0], changed.threads[root]), { turn: "agent", changed: true });
});
test("damaged feedback hides only itself, with a warning that names its file", async () => {
  const id = "threads-scoped";
  await putCollection(collection(id));
  const root = await comment(id, "Focus the first item.");
  await mkdir(join(directory, "data", "brief-feedback", id, "reviews", "api"), { recursive: true });
  await writeFile(join(directory, "data", "brief-feedback", id, "answer-rollout-damaged.json"), "{");
  await writeFile(join(directory, "data", "brief-feedback", id, "reviews", "api", "answer-rollout-other.json"), JSON.stringify({ id: "answer-rollout-else" }));
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  try {
    assert.match((await feedbackText(id, { review: "ui" })).text, /Focus the first item\./);
    assert.equal((await feedbackJson(id, { review: "ui" })).reviews[0].codeComments.length, 1);
    assert.match((await feedbackText(id)).text, /Focus the first item\./);
    await replyAsAgent(id, [{ id: root, body: "Focused on open.", resolve: true }]);
  } finally { console.warn = warn; }
  assert.ok(warnings.some((message) => message.startsWith(`Skipped feedback answer-rollout-damaged.json in ${id}: `)), warnings.join("\n"));
  assert.ok(warnings.some((message) => message.startsWith(`Skipped feedback answer-rollout-other.json in ${id}/api: `)), warnings.join("\n"));
  assert.equal(threadState((await codeComments(id, "ui")).comments[0], (await codeComments(id, "ui")).threads[root]).turn, "resolved");
});
test("a damaged reply file hides only itself", async () => {
  const id = "threads-damaged";
  await putCollection(collection(id));
  const root = await comment(id, "Check this.");
  await replyAsAgent(id, [{ id: root, body: "Checked." }]);
  const folder = join(directory, "data", "code-comments", id, "ui", "threads", root);
  await writeFile(join(folder, `${randomUUID()}.json`), "{");
  await mkdir(join(directory, "data", "code-comments", id, "ui", "threads", "not-a-comment"), { recursive: true });
  const warn = console.warn;
  console.warn = () => {};
  try { assert.deepEqual((await codeComments(id, "ui")).threads[root].map((entry) => entry.body), ["Checked."]); }
  finally { console.warn = warn; }
  assert.equal((await readdir(folder)).length, 2);
});

test("a reply to an item the reader acted on after it was read is refused, and nothing in its batch is sent", async () => {
  const id = "threads-stale";
  await putCollection(collection(id));
  const root = await comment(id, "Check the empty state.");
  const other = await comment(id, "Rename this.");
  const printed = async () => Object.fromEntries((await feedbackJson(id, { review: "ui", all: true })).reviews[0].codeComments.map((item) => [item.id, item.replyId]));
  const first = await printed();
  assert.match(first[root], new RegExp(`^${root.slice(0, 8)}\\.[a-z0-9]{4}$`));
  assert.ok((await feedbackText(id)).text.includes(`ID: ${first[root]}\n`));
  await saveCodeComment(id, "ui", { kind: "reply", entry: root, id: randomUUID(), body: "Also the loading state." });
  await assert.rejects(replyAsAgent(id, [{ id: first[other], body: "Renamed." }, { id: first[root], body: "Fixed.", resolve: true }]),
    /^Error: [a-f0-9]{8}\.[a-z0-9]{4}: the reader replied after you read it \(Show saved filters: src\/menu\.tsx:3\)\.\nNothing was sent\. Read the feedback again with pnpm feedback threads-stale, then reply to what is there now\.$/);
  assert.equal((await codeComments(id, "ui")).threads[other], undefined, "the valid reply in the batch was not sent either");
  const second = await printed();
  assert.equal(second[other], first[other], "the agent's own replies and other items keep their IDs");
  await replyAsAgent(id, [{ id: second[root], body: "Both states show the empty message now." }]);
  assert.equal((await printed())[root], second[root]);
  await replyAsAgent(id, [{ id: second[root], body: "And they have a test.", resolve: true }]);
  await saveCodeComment(id, "ui", { kind: "reopen", entry: root });
  await assert.rejects(replyAsAgent(id, [{ id: second[root], body: "Done." }]), /the reader reopened this after you read it/);
  await saveCodeComment(id, "ui", { kind: "save", id: other, group: "menu", path: "src/menu.tsx", line: { side: "new", number: 3, text: "open()" }, body: "Rename this and its test." });
  await assert.rejects(replyAsAgent(id, [{ id: first[other], body: "Renamed." }]), /the reader changed this after you read it/);
  await replyAsAgent(id, [{ id: other, body: "Renamed both; an ID without its ending skips the check." }]);
});
test("an ID in more than one place needs --review or --feature", async () => {
  const id = "threads-ambiguous";
  await putCollection(collection(id));
  const feature = await briefSnapshot(id);
  const answer = { kind: "answer", block: "rollout", revision: feature.fingerprints.rollout, answer: { kind: "option", option: "yes" } };
  await saveBriefFeedback(id, answer);
  await saveBriefFeedback(id, answer, "api");
  const short = `answer-rollout-${feature.fingerprints.rollout.slice(0, 8)}`;
  await assert.rejects(replyAsAgent(id, [{ id: short, body: "Shipping it first." }]),
    /this matches 2 items: feature overview: Ship it first\? \(--feature\); Store filters: Ship it first\? \(--review api\)\. Add the option for the one you mean\./);
  await assert.rejects(replyAsAgent(id, [{ id: short, body: "Both?", review: "api", feature: true }]), /give a review or the feature overview, not both\./);
  await replyAsAgent(id, [{ id: short, body: "Shipping it first.", feature: true }, { id: short, body: "The API ships first.", review: "api", resolve: true }]);
  const [whole, part] = [await briefSnapshot(id), await briefSnapshot(id, "api")];
  assert.equal(threadState(whole.feedback[0], whole.threads[whole.feedback[0].id]).turn, "person");
  assert.equal(threadState(part.feedback[0], part.threads[part.feedback[0].id]).turn, "resolved");
});
test("an overview comment saved unchanged stays resolved, a reader reply reopens it, and deleting it removes its thread", async () => {
  const id = "threads-overview";
  await putCollection(collection(id));
  const api = await briefSnapshot(id, "api");
  const commentId = randomUUID();
  const save = (body: string) => saveBriefFeedback(id, { kind: "comment", id: commentId, body, anchor: { kind: "document", revision: api.version, title: "Store filters" } }, "api");
  await save("Who opens these?");
  await replyAsAgent(id, [{ id: commentId, body: "Only the owner.", resolve: true }]);
  const state = async () => { const snapshot = await briefSnapshot(id, "api"); return threadState(snapshot.feedback[0], snapshot.threads[commentId]).turn; };
  await save("Who opens these?");
  assert.equal(await state(), "resolved");
  await saveBriefFeedback(id, { kind: "reply", entry: commentId, id: randomUUID(), body: "And admins?" }, "api");
  assert.equal(await state(), "agent");
  await saveBriefFeedback(id, { kind: "delete", id: commentId }, "api");
  await assert.rejects(stat(join(directory, "data", "brief-feedback", id, "reviews", "api", "threads", commentId)), { code: "ENOENT" });
});

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = (...args: string[]) => promisify(execFile)(join(root, "node_modules", ".bin", "tsx"), [join(root, "scripts", "brief-feedback.ts"), ...args],
  { cwd: root, env: { ...process.env, PORT: "1" } }).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
  (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
test("the feedback CLI replies to one item or a batch file, and rejects misuse", async () => {
  const id = "threads-cli";
  await putCollection(collection(id));
  const first = await comment(id, "Why?");
  const second = await comment(id, "Rename.");
  const one = await cli("reply", id, first.slice(0, 8), "Because the menu reuses it.");
  assert.equal(one.code, 0, one.stderr);
  assert.equal(one.stdout, `Replied to 1 item:\n- ${first.slice(0, 8)} · Show saved filters: src/menu.tsx:3\n`);
  const file = join(directory, "replies.json");
  await writeFile(file, JSON.stringify([{ id: second, body: "Renamed.", resolve: true }, { id: first, body: "And it is tested.", review: "ui" }]));
  const batch = await cli("reply", id, "--file", file);
  assert.equal(batch.code, 0, batch.stderr);
  assert.match(batch.stdout, /^Replied to 2 items, resolving 1:\n/);
  const resolved = await cli("reply", id, first, "Done.", "--resolve", "--review", "ui");
  assert.equal(resolved.code, 0, resolved.stderr);
  const { comments, threads } = await codeComments(id, "ui");
  assert.deepEqual(comments.map((entry) => threadState(entry, threads[entry.id]).turn), ["resolved", "resolved"]);
  assert.match((await cli(id)).stdout, /Nothing is waiting on the agent\./);
  for (const args of [["reply", id, first], ["reply", id, first, "Text", "--json"], ["reply", id, "--file"], ["reply", id, first, "Text", "--review", "ui", "--feature"],
    [id, "--resolve"], [id, "--unknown"]]) {
    const misuse = await cli(...args);
    assert.equal(misuse.code, 1, args.join(" "));
    assert.match(misuse.stderr, /^Usage: pnpm feedback <collection-id>/);
  }
  await writeFile(file, JSON.stringify([{ id: first }]));
  const invalid = await cli("reply", id, "--file", file);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /replies\.json, reply 1 \(body\): /);
  await writeFile(file, "[{");
  assert.match((await cli("reply", id, "--file", file)).stderr, /replies\.json is not valid JSON: /);
  const dashed = await cli("reply", id, second, "--", "--resolve is a flag; this reply only mentions it.");
  assert.equal(dashed.code, 0, dashed.stderr);
  assert.equal((await codeComments(id, "ui")).threads[second].at(-1)?.body, "--resolve is a flag; this reply only mentions it.");
});
