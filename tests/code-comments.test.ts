import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { briefSnapshot, saveBriefFeedback } from "../server/briefs.ts";
import { codeComments, readCodeComments, saveCodeComment } from "../server/code-comments.ts";
import { feedbackText } from "../server/feedback.ts";
import { putCollection } from "../server/collections.ts";
import { anchorLine, cardKey, clipLine, commentCard, patchLines, placeComments, reviewsShowing, sourceLine, type CodeComment } from "../src/code-comments.ts";
import { exportFeedback, groupTitleIn } from "../src/brief-feedback.ts";
import { readerStamp } from "../src/threads.ts";
import { shownLines } from "../src/whitespace-diff.ts";
import type { Collection } from "../src/review-types.ts";

let directory = "";
before(async () => { directory = await mkdtemp(join(tmpdir(), "preread-code-comments-")); process.env.PREREAD_DATA_DIR = join(directory, "data"); });
after(async () => { delete process.env.PREREAD_DATA_DIR; await rm(directory, { recursive: true, force: true }); });

const collection = (id: string, brief = false): Collection => ({
  id, title: "Saved filters", description: "",
  reviews: [
    { id: "api", title: "Store filters", description: "", path: join(directory, "repository"), base: "main", mode: "branch",
      groups: [{ id: "schema", title: "Schema", description: "", targets: [{ path: "src/schema.ts" }] }],
      ...(brief ? { brief: { blocks: [{ id: "story", kind: "question", question: "Ship it?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] }] } } : {}) },
    { id: "ui", title: "Show saved filters", description: "", path: join(directory, "repository"), base: "main", mode: "branch",
      groups: [{ id: "menu", title: "Menu", description: "", targets: [{ path: "src/menu.tsx" }] }] },
  ],
});
const save = (id: string, review: string, fields: Partial<CodeComment> & { body: string }) =>
  saveCodeComment(id, review, { kind: "save", id: randomUUID(), group: review === "api" ? "schema" : "menu", path: review === "api" ? "src/schema.ts" : "src/menu.tsx", ...fields })
    .then((state) => state.comments);

test("patch lines are keyed by side and number, with context lines on the new side and CRs dropped", () => {
  const patch = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -3,4 +3,4 @@ function top()", " same", "-old\r", "+new\r", " ", "\\ No newline at end of file",
    "@@ -20 +20,2 @@", " tail", "+added", "trailing text outside every hunk"].join("\n");
  assert.deepEqual([...patchLines(patch)], [["new:3", "same"], ["old:4", "old"], ["new:4", "new"], ["new:5", ""], ["new:20", "tail"], ["new:21", "added"]]);
});
test("with whitespace ignored, a line that only changed spaces shows as context on the new side", () => {
  const patch = ["--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", "-  indented", "+    indented", "-gone", "+came"].join("\n");
  assert.deepEqual([...shownLines(patch, false)], [["old:1", "  indented"], ["new:1", "    indented"], ["old:2", "gone"], ["new:2", "came"]]);
  assert.deepEqual([...shownLines(patch, true)], [["new:1", "    indented"], ["old:2", "gone"], ["new:2", "came"]]);
});
test("code comments are saved per review in private files, sorted, edited in place and deleted idempotently", async () => {
  const id = "comment-store";
  await putCollection(collection(id));
  const later = await save(id, "ui", { line: { side: "new", number: 12, text: "return menu;" }, body: "  Close the menu first.  " });
  assert.equal(later[0].body, "Close the menu first.");
  const whole = await save(id, "ui", { body: "Split this file." });
  assert.deepEqual(whole.map((comment) => comment.line?.number ?? 0), [0, 12]);
  const folder = join(directory, "data", "code-comments", id, "ui");
  assert.equal((await stat(folder)).mode & 0o777, 0o700);
  assert.equal((await stat(join(folder, `${later[0].id}.json`))).mode & 0o777, 0o600);
  assert.deepEqual(await readCodeComments(id, "api"), []);
  const [first] = later;
  const edited = await saveCodeComment(id, "ui", { kind: "save", id: first.id, group: first.group, path: first.path, line: first.line, body: "Close it." });
  const updated = edited.comments.find((comment) => comment.id === first.id)!;
  assert.equal(updated.body, "Close it.");
  assert.equal(updated.createdAt, first.createdAt);
  await assert.rejects(saveCodeComment(id, "ui", { kind: "save", id: first.id, group: first.group, path: first.path,
    line: { ...first.line!, number: 13 }, body: "Moved." }), /cannot move it to another line/);
  await assert.rejects(save(id, "ui", { group: "schema", body: "Wrong group." }), /That group is not in this review/);
  assert.equal((await save(id, "ui", { group: "other-changes", body: "Unassigned is fine." })).length, 3);
  for (const path of ["../outside.ts", "/etc/passwd", "src//menu.tsx", "src\\menu.tsx"])
    await assert.rejects(save(id, "ui", { path, body: "Nope." }), /repository-relative/);
  await assert.rejects(save(id, "ui", { body: "   " }), /Write a comment/);
  await assert.rejects(save(id, "ui", { id: randomUUID().toUpperCase(), body: "Capital ID." }), /lowercase UUID/);
  await assert.rejects(save(id, "missing", { body: "No review." }), /not in this collection/);
  await assert.rejects(codeComments(id, "missing"), /not in this collection/);
  assert.equal((await saveCodeComment(id, "ui", { kind: "delete", id: first.id })).comments.length, 2);
  assert.equal((await saveCodeComment(id, "ui", { kind: "delete", id: first.id })).comments.length, 2);
});
test("a damaged comment file hides only itself", async () => {
  const id = "comment-damaged";
  await putCollection(collection(id));
  await save(id, "ui", { body: "Still here." });
  await writeFile(join(directory, "data", "code-comments", id, "ui", `${randomUUID()}.json`), "{");
  const warn = console.warn;
  console.warn = () => {};
  try { assert.deepEqual((await codeComments(id, "ui")).comments.map((comment) => comment.body), ["Still here."]); }
  finally { console.warn = warn; }
});
test("exported code comments name the file, line, group and line text", () => {
  const base = { createdAt: "2026-11-15T00:00:00.000Z", updatedAt: "2026-11-15T00:00:00.000Z", group: "menu", path: "src/menu.tsx" };
  const comments: CodeComment[] = [
    { ...base, id: "a1000000-0000-4000-8000-000000000000", line: { side: "old", number: 4, text: "  " }, body: "Why remove this?" },
    { ...base, id: "b2000000-0000-4000-8000-000000000000", body: "Split this file." },
    { ...base, id: "c3000000-0000-4000-8000-000000000000", group: "gone", path: "src/a.ts", line: { side: "new", number: 9, text: "const a = 1;" }, body: "Rename." },
  ];
  const { text } = exportFeedback({ collection: "filters", title: "Saved filters", ids: new Map(comments.map((comment) => [comment.id, comment.id.slice(0, 8)])),
    reviews: [{ title: "Show saved filters", code: { comments, threads: {} }, groupTitle: (group) => group === "menu" ? "Menu" : undefined }] });
  const stamp = readerStamp(base);
  assert.equal(text, ["Feature: Saved filters", "Review: Show saved filters", "Code comments:", `1. src/a.ts:9\nID: c3000000.${stamp}\nLine: const a = 1;\nRename.`,
    `2. src/menu.tsx (whole file)\nID: b2000000.${stamp}\nGroup: Menu\nSplit this file.`, `3. src/menu.tsx:4 (removed line)\nID: a1000000.${stamp}\nGroup: Menu\nLine: (blank line)\nWhy remove this?`,
    "Reply to an item with pnpm feedback reply filters <ID> \"<reply>\", adding --resolve once it is handled."].join("\n\n"));
});
test("unassigned changes are titled All changes in a review without groups", () => {
  assert.equal(groupTitleIn({ groups: [] })("other-changes"), "All changes");
  assert.equal(groupTitleIn({ groups: [{ id: "menu", title: "Menu", description: "", targets: [{ path: "src/menu.tsx" }] }] })("other-changes"), "Other changes");
});
test("a comment follows its line's text, and shows under its file when no single line matches", () => {
  const lines = new Map([["new:3", "const a = 1;"], ["new:7", "return a;"], ["old:7", "return b;"], ["new:9", "}"], ["new:12", "}"]]);
  const at = (side: "old" | "new", number: number, text: string) => anchorLine({ side, number, text }, lines);
  assert.equal(at("new", 3, "const a = 1;"), "new:3");
  assert.equal(at("new", 5, "return a;"), "new:7", "lines above it moved");
  assert.equal(at("old", 2, "return b;"), "old:7");
  assert.equal(at("new", 7, "return b;"), "", "the same text on the other side is another line");
  assert.equal(at("new", 9, "}"), "new:9", "its own line still matches");
  assert.equal(at("new", 10, "}"), "", "two lines have this text");
  assert.equal(at("new", 3, "const a = 2;"), "");
  assert.equal(anchorLine({ side: "new", number: 3, text: "const a = 1;" }, null), "");
  const long = "x".repeat(5000);
  assert.equal(anchorLine({ side: "new", number: 1, text: clipLine(long) }, new Map([["new:1", long]])), "new:1", "a long line matches by its start");
});
test("comments follow a file into another group or to a new name, and gather apart when it leaves the review", () => {
  const comment = (group: string, path: string): CodeComment =>
    ({ id: randomUUID(), createdAt: "2026-11-15T00:00:00.000Z", updatedAt: "2026-11-15T00:00:00.000Z", group, path, body: "Check." });
  const sections = [
    { id: "saving", files: [{ file: { path: "src/save.ts" } }, { file: { path: "src/shared.ts" } }] },
    { id: "ownership", files: [{ file: { path: "src/owner.ts", oldPath: "src/owners.ts" } }, { file: { path: "src/shared.ts" } }] },
  ];
  const own = comment("ownership", "src/shared.ts"), moved = comment("gone", "src/save.ts"), renamed = comment("ownership", "src/owners.ts");
  const left = comment("saving", "src/deleted.ts"), regrouped = comment("tests", "src/shared.ts");
  const { cards, unplaced } = placeComments([own, moved, renamed, left, regrouped], sections);
  assert.deepEqual([...cards].map(([key, list]) => [key, list.map((entry) => entry.id)]), [
    [cardKey("ownership", "src/shared.ts"), [own.id]], [cardKey("saving", "src/save.ts"), [moved.id]],
    [cardKey("ownership", "src/owner.ts"), [renamed.id]], [cardKey("saving", "src/shared.ts"), [regrouped.id]],
  ]);
  assert.deepEqual(unplaced, [left]);
  assert.equal(commentCard("saving", "src/deleted.ts", sections), undefined);
});
test("a comment whose file left its review finds each part that shows the file now", () => {
  const sources = {
    index: { sections: [{ id: "mapping", files: [{ path: "src/config.js" }, { path: "src/view.ts" }] }] },
    search: { sections: [{ id: "fields", files: [{ path: "src/search.ts" }] }] },
    tests: { sections: [{ id: "other", files: [{ path: "src/other.ts" }] }, { id: "view", files: [{ path: "src/view.ts" }] }] },
  };
  const reviews = [{ id: "index" }, { id: "search" }, { id: "tests" }, { id: "checking" }];
  assert.deepEqual(reviewsShowing("src/view.ts", reviews, sources), [{ review: reviews[0], group: "mapping" }, { review: reviews[2], group: "view" }]);
  assert.deepEqual(reviewsShowing("src/gone.ts", reviews, sources), []);
});
test("the source viewer opens a comment at its line's text, which may have moved", () => {
  const code = "import a;\r\nconst fields = [];\r\n}\n";
  assert.equal(sourceLine({ side: "new", number: 2, text: "const fields = [];" }, code), 2);
  assert.equal(sourceLine({ side: "new", number: 9, text: "const fields = [];" }, code), 2, "lines above it moved");
  assert.equal(sourceLine({ side: "old", number: 5, text: "gone();" }, code), 5, "with no match, the saved number stands");
});
test("feedback includes each review's code comments, with or without a brief, and attention counts them", async () => {
  const id = "comment-feedback";
  await putCollection(collection(id, true));
  await save(id, "ui", { line: { side: "new", number: 3, text: "open()" }, body: "Focus the first item." });
  const all = await feedbackText(id);
  assert.equal(all.shown, 1);
  assert.match(all.text, new RegExp(["^Feature: Saved filters", "Review: Show saved filters", "Code comments:",
    "1\\. src/menu\\.tsx:3\nID: [a-f0-9]{8}\\.[a-z0-9]{4}\nGroup: Menu\nLine: open\\(\\)\nFocus the first item\\.", "Nothing waiting on the agent in review: Store filters\nReply to an item with "].join("\n\n")));
  const snapshot = await briefSnapshot(id, "api");
  assert.deepEqual(snapshot.attention?.code, { ui: { agent: 1, person: 0, resolved: 0 } });
  await saveBriefFeedback(id, { kind: "answer", block: "story", revision: snapshot.fingerprints.story, answer: { kind: "option", option: "yes" } }, "api");
  await save(id, "api", { body: "Add an index." });
  const both = await feedbackText(id);
  assert.equal(both.shown, 3);
  assert.match(both.text, /\n\nReview: Store filters\nBrief revision: [a-f0-9]{64}\n\n1\. answer: Ship it\?\nID: answer-story-[a-f0-9]{8}\.[a-z0-9]{4}\nYes\n\nCode comments:\n\n1\. src\/schema\.ts \(whole file\)\nID: [a-f0-9]{8}\.[a-z0-9]{4}\nGroup: Schema\nAdd an index\.\n\nReview: Show saved filters\n/);
  assert.doesNotMatch(both.text, /Nothing waiting/);
});
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = (...args: string[]) => promisify(execFile)(join(root, "node_modules", ".bin", "tsx"), [join(root, "scripts", "brief-feedback.ts"), ...args],
  { cwd: root, env: { ...process.env, PORT: "1" } }).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
  (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
test("the feedback CLI prints and serializes code comments, including for a review without a brief", async () => {
  const id = "comment-cli";
  await putCollection(collection(id));
  await save(id, "ui", { line: { side: "new", number: 3, text: "open()" }, body: "Focus the first item." });
  const text = await cli(id);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^Feature: Saved filters\n\nReview: Show saved filters\n\nCode comments:\n\n1\. src\/menu\.tsx:3\n/);
  const one = await cli(id, "--review", "ui");
  assert.match(one.stdout, /^Feature: Saved filters\n\nReview: Show saved filters\n\nCode comments:\n\n1\. src\/menu\.tsx:3\nID: [a-f0-9]{8}\.[a-z0-9]{4}\nGroup: Menu\nLine: open\(\)\nFocus the first item\.\n\nReply to an item with pnpm feedback reply comment-cli <ID> "<reply>", adding --resolve once it is handled\.\n$/);
  assert.equal((await cli(id, "--review", "api")).stdout, "Feature: Saved filters\n\nReview: Store filters\n\nNo feedback yet.\n");
  const json = JSON.parse((await cli(id, "--json")).stdout);
  assert.deepEqual(json.reviews.map((entry: { review: string; feedback: unknown[]; codeComments: CodeComment[] }) =>
    [entry.review, entry.feedback.length, entry.codeComments.map((comment) => comment.body)]), [["ui", 0, ["Focus the first item."]]]);
});
