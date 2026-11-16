import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { briefSnapshot, collectionFeedbackText, readBriefVisual, readCommentAttachment, saveBriefFeedback } from "../server/briefs.ts";
import { storeCommentImage } from "../server/comment-images.ts";
import { putCollection, putCollectionBrief, readCollection, readReceipts, setReceipt, validateCollection } from "../server/collections.ts";
import { anchorQuote, exportBriefFeedback, exportReviewFeedback, feedbackCurrent } from "../src/brief-feedback.ts";
import { Markdown } from "../src/Markdown.tsx";
import { HighlightedCode } from "../src/HighlightedCode.tsx";
import type { BriefBlock, BriefSelection } from "../src/brief-types.ts";
import type { Collection } from "../src/review-types.ts";

let directory: string;
before(async () => { directory = await mkdtemp(join(tmpdir(), "preread-brief-")); process.env.PREREAD_DATA_DIR = join(directory, "data"); });
after(async () => { delete process.env.PREREAD_DATA_DIR; await rm(directory, { recursive: true, force: true }); });
const blocks: BriefBlock[] = [
  { id: "story", kind: "markdown", markdown: "## A live view\n\nSave **criteria**, then rerun the search." },
  { id: "sharing", kind: "question", question: "Who can open it?", options: [{ id: "personal", label: "Just me", recommended: true }, { id: "team", label: "My team" }] },
  { id: "ownership", kind: "code", language: "ts", code: "findFilter(id, user.id)", title: "Ownership check", approval: true, reference: { review: "implementation", group: "query" } },
];
const collection = (id: string, content = blocks): Collection => ({ id, title: "Saved search filters", description: "A live view you can return to.", brief: { blocks: content },
  reviews: [{ id: "implementation", title: "Store personal filters", description: "", path: join(directory, "repository"), base: "main", mode: "branch", groups: [{ id: "query", title: "Ownership query", description: "", targets: [{ path: "src/filters.ts" }] }] }] });
async function create(id: string) { await putCollection(collection(id)); return briefSnapshot(id); }
const selection = (revision: string): BriefSelection => ({ kind: "selection", segments: [{ block: "story", revision, part: "markdown", text: "Save criteria, then rerun the search.", start: 5, end: 13 }] });

test("adding only a brief preserves the active collection file, groups, visuals, and receipts", async () => {
  const { brief, ...metadata } = collection("active-collection");
  await putCollection(metadata);
  await setReceipt(metadata.id, "implementation", "query", "reviewed-fingerprint");
  const path = join(directory, "data", "collections", `${metadata.id}.json`);
  const before = await readFile(path, "utf8");
  const receipts = await readReceipts(metadata.id);
  await putCollectionBrief(metadata.id, brief);
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual((await readCollection(metadata.id)).reviews, metadata.reviews);
  assert.deepEqual(await readReceipts(metadata.id), receipts);
  assert.deepEqual((await readCollection(metadata.id)).brief, brief);
  assert.equal((await stat(join(directory, "data", "briefs", `${metadata.id}.json`))).mode & 0o777, 0o600);
  await assert.rejects(putCollectionBrief(metadata.id, { blocks: [{ ...blocks[2], reference: { review: "implementation", group: "unknown" } }] }), /existing group/);
  assert.equal(await readFile(path, "utf8"), before);
});
test("collection writers can update groups without overwriting the separately authored brief", async () => {
  const initial = await create("separate-brief");
  const path = join(directory, "data", "collections", "separate-brief.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal("brief" in saved, false);
  saved.reviews[0].groups[0].description = "Updated by the implementation agent.";
  await writeFile(path, JSON.stringify(saved));
  assert.deepEqual((await readCollection("separate-brief")).brief, initial.brief);
  assert.equal((await readCollection("separate-brief")).reviews[0].groups[0].description, "Updated by the implementation agent.");
  saved.reviews[0].groups[0].id = "renamed-query";
  await putCollection(saved);
  const changed = await readCollection("separate-brief");
  assert.deepEqual(changed.brief, initial.brief);
  assert.equal(changed.reviews[0].groups[0].id, "renamed-query");
  const newBrief = { blocks: [blocks[0]] };
  await putCollection({ ...saved, brief: newBrief });
  assert.deepEqual((await readCollection("separate-brief")).brief, newBrief);
  assert.equal("brief" in JSON.parse(await readFile(path, "utf8")), false);
});

test("briefs retain authored order, reject malformed interactions, and resolve code references", async () => {
  const value = collection("schema");
  assert.deepEqual(validateCollection(value).brief?.blocks.map((block) => block.kind), ["markdown", "question", "code"]);
  assert.throws(() => validateCollection({ ...value, brief: { blocks: [blocks[0], blocks[0]] } }), /unique/);
  assert.throws(() => validateCollection({ ...value, brief: { blocks: [{ ...blocks[0], script: "alert(1)" }] } }));
  assert.throws(() => validateCollection({ ...value, brief: { blocks: [{ ...blocks[2], reference: { review: "implementation", group: "missing" } }] } }), /existing group/);
  assert.throws(() => validateCollection({ ...value, brief: { blocks: [{ ...blocks[1], options: [{ id: "one", label: "One", recommended: true }, { id: "two", label: "Two", recommended: true }] }] } }), /recommended/);
});
test("excerpt source locations name a file in their group and use ordered repository-relative lines", () => {
  const value = collection("locations");
  const located = (file: unknown) => ({ ...value, brief: { blocks: [{ ...blocks[2], reference: { review: "implementation", group: "query", file } }] } });
  const valid = validateCollection(located({ path: "src/filters.ts", start: 4, end: 8 }));
  const block = valid.brief?.blocks[0];
  assert.deepEqual(block?.kind === "code" && block.reference?.file, { path: "src/filters.ts", start: 4, end: 8 });
  assert.throws(() => validateCollection(located({ path: "src/other.ts", start: 1, end: 2 })), /belong/);
  for (const path of ["/tmp/secret", "../secret", "src/../secret", "C:/secret", "src\\secret"])
    assert.throws(() => validateCollection(located({ path, start: 1, end: 2 })), /repository-relative/);
  assert.throws(() => validateCollection(located({ path: "src/filters.ts", start: 8, end: 4 })), /ordered/);
  assert.throws(() => validateCollection(located({ path: "src/filters.ts", start: 0, end: 4 })));
});
test("recommendations do not answer questions; saved answers are editable and idempotent", async () => {
  const initial = await create("answers");
  assert.equal(initial.feedback.length, 0);
  const command = { kind: "answer", block: "sharing", revision: initial.fingerprints.sharing, answer: { kind: "custom", text: "Personal first; sharing later." } };
  await saveBriefFeedback("answers", command);
  await saveBriefFeedback("answers", command);
  const updated = await saveBriefFeedback("answers", { ...command, answer: { kind: "option", option: "team" } });
  assert.equal(updated.feedback.length, 1);
  assert.equal(updated.feedback[0].kind, "answer");
  assert.match(exportBriefFeedback("Filters", updated), /My team/);
  await assert.rejects(saveBriefFeedback("answers", { ...command, answer: { kind: "option", option: "unknown" } }), /does not belong/);
  await assert.rejects(saveBriefFeedback("answers", { ...command, answer: { kind: "custom", text: " " } }));
});
test("excerpt approvals preserve exact code and reopen only when that block changes", async () => {
  const initial = await create("approvals");
  await saveBriefFeedback("approvals", { kind: "answer", block: "sharing", revision: initial.fingerprints.sharing, answer: { kind: "option", option: "personal" } });
  const approved = await saveBriefFeedback("approvals", { kind: "approve", block: "ownership", revision: initial.fingerprints.ownership, approved: true });
  assert.equal(approved.feedback.filter((entry) => entry.kind === "approval").length, 1);
  await putCollection(collection("approvals", blocks.map((block) => block.kind === "markdown" ? { ...block, markdown: "A clearer introduction." } : block)));
  const proseChanged = await briefSnapshot("approvals");
  assert.ok(proseChanged.feedback.every((entry) => feedbackCurrent(entry, proseChanged)));
  await putCollection(collection("approvals", blocks.map((block) => block.kind === "code" ? { ...block, code: "findFilter(id, team.id)" } : block)));
  const codeChanged = await briefSnapshot("approvals");
  const approval = codeChanged.feedback.find((entry) => entry.kind === "approval");
  assert.ok(approval);
  assert.equal(feedbackCurrent(approval, codeChanged), false);
  assert.equal(codeChanged.feedback.filter((entry) => feedbackCurrent(entry, codeChanged)).length, 1);
  assert.match(exportBriefFeedback("Filters", codeChanged), /earlier revision/);
  assert.match(exportBriefFeedback("Filters", codeChanged), /findFilter\(id, user.id\)/);
  await assert.rejects(saveBriefFeedback("approvals", { kind: "approve", block: "ownership", revision: initial.fingerprints.ownership, approved: true }), /changed/);
});
test("comments retain their selected quote and offsets, including after a revision changes", async () => {
  const initial = await create("comments");
  const anchor = selection(initial.fingerprints.story);
  const id = randomUUID();
  await saveBriefFeedback("comments", { kind: "comment", id, body: "Should criteria be validated on reopen?", anchor });
  const updated = await saveBriefFeedback("comments", { kind: "comment", id, body: "Please validate on reopen.", anchor });
  assert.equal(updated.feedback.length, 1);
  assert.equal(anchorQuote(anchor), "criteria");
  await putCollection(collection("comments", blocks.map((block) => block.kind === "markdown" ? { ...block, markdown: "The document has changed." } : block)));
  const changed = await saveBriefFeedback("comments", { kind: "comment", id, body: "Keep this concern for the next revision.", anchor });
  assert.equal(feedbackCurrent(changed.feedback[0], changed), false);
  assert.match(exportBriefFeedback("Filters", changed), /Selected text: “criteria”/);
  await assert.rejects(saveBriefFeedback("comments", { kind: "comment", id: randomUUID(), body: "New note", anchor }), /changed/);
  await assert.rejects(saveBriefFeedback("comments", { kind: "comment", id, body: "Moved", anchor: { ...anchor, segments: [{ ...anchor.segments[0], start: 0 }] } }), /cannot move/);
});
test("selection boundaries and block types are checked before saving feedback", async () => {
  const initial = await create("boundaries");
  const anchor = selection(initial.fingerprints.story);
  await assert.rejects(saveBriefFeedback("boundaries", { kind: "comment", id: randomUUID(), body: "Bad range", anchor: { ...anchor, segments: [{ ...anchor.segments[0], end: 900 }] } }));
  await assert.rejects(saveBriefFeedback("boundaries", { kind: "comment", id: randomUUID(), body: "Wrong type", anchor: { ...anchor, segments: [{ ...anchor.segments[0], part: "code" }] } }), /does not match/);
  await assert.rejects(saveBriefFeedback("boundaries", { kind: "approve", block: "story", revision: initial.fingerprints.story, approved: true }), /does not request/);
  await assert.rejects(saveBriefFeedback("boundaries", { kind: "delete", id: "../../outside" }));
});
test("concurrent comments do not overwrite one another and deleting one preserves the others", async () => {
  const initial = await create("concurrent");
  const ids = Array.from({ length: 8 }, () => randomUUID());
  await Promise.all(ids.map((id, index) => saveBriefFeedback("concurrent", { kind: "comment", id, body: `Question ${index}`, anchor: selection(initial.fingerprints.story) })));
  assert.equal((await briefSnapshot("concurrent")).feedback.length, 8);
  await saveBriefFeedback("concurrent", { kind: "delete", id: ids[0] });
  await saveBriefFeedback("concurrent", { kind: "delete", id: ids[0] });
  assert.equal((await briefSnapshot("concurrent")).feedback.length, 7);
  const path = join(directory, "data", "brief-feedback", "concurrent", `${ids[1]}.json`);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.match(await readFile(path, "utf8"), /Question 1/);
});
test("brief visuals are copied into app storage and cannot read an arbitrary path", async () => {
  const source = join(directory, "example.svg");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
  await writeFile(source, svg);
  await putCollection(collection("visuals", [{ kind: "visual", id: "example", visual: { id: "image", title: "Example", path: source, caption: "A local visual." } }]));
  const imported = await readCollection("visuals");
  assert.notEqual(imported.brief?.blocks[0].kind === "visual" && imported.brief.blocks[0].visual.path, source);
  await writeFile(source, "Changed source");
  assert.equal((await readBriefVisual("visuals", "example")).content.toString(), svg);
  await assert.rejects(readBriefVisual("visuals", "../../outside"), /not in/);
});
test("comment images survive edits, export their paths, and are scoped to the saved comment", async () => {
  const initial = await create("image-comments");
  await create("other-images");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=", "base64");
  const image = await storeCommentImage("image-comments", "feedback.png", png);
  assert.equal((await stat(image.path)).mode & 0o777, 0o600);
  const id = randomUUID();
  const command = { kind: "comment", id, body: "", attachments: [image.id], anchor: selection(initial.fingerprints.story) };
  await saveBriefFeedback("image-comments", command);
  const edited = await saveBriefFeedback("image-comments", { ...command, body: "This is the state I saw." });
  const entry = edited.feedback.find((entry) => entry.id === id);
  assert.ok(entry?.kind === "comment");
  assert.deepEqual(entry.attachments, [image]);
  assert.deepEqual((await readCommentAttachment("image-comments", id, image.id)).content, png);
  assert.match(exportBriefFeedback("Filters", edited), /Image: feedback.png/);
  assert.ok(exportBriefFeedback("Filters", edited).includes(image.path));
  await assert.rejects(readCommentAttachment("image-comments", randomUUID(), image.id), /not attached/);
  await assert.rejects(saveBriefFeedback("other-images", { ...command, anchor: selection((await briefSnapshot("other-images")).fingerprints.story) }));
  await assert.rejects(saveBriefFeedback("image-comments", { ...command, attachments: [image.id, image.id] }), /once/);
  await saveBriefFeedback("image-comments", { ...command, body: "Image removed", attachments: [] });
  await assert.rejects(readCommentAttachment("image-comments", id, image.id), /not attached/);
  await assert.rejects(storeCommentImage("image-comments", "fake.png", Buffer.from("<script>alert(1)</script>")), /format/);
  await assert.rejects(storeCommentImage("image-comments", "script.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), /PNG/);
  await assert.rejects(storeCommentImage("image-comments", "../outside.png", png), /name/);
  await assert.rejects(storeCommentImage("image-comments", "huge.png", Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MB/);
});
test("comments written before image support still open and remain editable", async () => {
  const initial = await create("legacy-comment");
  const id = randomUUID();
  const command = { kind: "comment", id, body: "Original note", anchor: selection(initial.fingerprints.story) };
  await saveBriefFeedback("legacy-comment", command);
  const path = join(directory, "data", "brief-feedback", "legacy-comment", `${id}.json`);
  const saved = JSON.parse(await readFile(path, "utf8"));
  delete saved.attachments;
  await writeFile(path, JSON.stringify(saved));
  const entry = (await briefSnapshot("legacy-comment")).feedback[0];
  assert.ok(entry.kind === "comment");
  assert.deepEqual(entry.attachments, []);
  const edited = await saveBriefFeedback("legacy-comment", { ...command, body: "Edited original note" });
  assert.equal(edited.feedback.length, 1);
});
test("code excerpts and fences highlight their language while escaping source text", () => {
  const code = 'const label: string = "<script>alert(1)</script>";';
  const html = renderToStaticMarkup(createElement(HighlightedCode, { code, language: "typescript" }));
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-string/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  const fallback = renderToStaticMarkup(createElement(HighlightedCode, { code, language: "unknown-language" }));
  assert.match(fallback, /language-plaintext/);
  assert.doesNotMatch(fallback, /<span|<script>/);
  const markdown = renderToStaticMarkup(createElement(Markdown, { children: '```typescript\nconst ready = true;\n```' }));
  assert.match(markdown, /hljs-keyword/);
});
test("authored Markdown supports formatting and tables while omitting scripts and external images", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { children: "## A heading\n\n**Bold** and `code`.\n\n| One | Two |\n| --- | --- |\n| A | B |\n\n<script>alert(1)</script>\n\n![Remote](https://example.com/tracker.png)\n\n[Bad](javascript:alert(1))" }));
  assert.match(html, /<h2>A heading<\/h2>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script|<img|src=|href="javascript:/);
});

const reviewBlocks = (review: string, group: string): BriefBlock[] => [
  { id: "story", kind: "markdown", markdown: `## Why ${review}\n\nRead [the change](preread:${review}/${group}).` },
  { id: "rollout", kind: "question", question: `Ship ${review} first?`, options: [{ id: "yes", label: "Yes", recommended: true }, { id: "no", label: "No" }] },
  { id: "check", kind: "code", language: "ts", code: "check()", approval: true, reference: { review, group } },
];
const featureBlocks = blocks.map((block): BriefBlock => block.kind === "code" ? { ...block, reference: { review: "api", group: "schema" } } : block);
const twoReviews = (id: string, briefs: { feature?: BriefBlock[]; api?: BriefBlock[]; ui?: BriefBlock[] } = {}): Collection => ({
  id, title: "Saved filters", description: "Two pull requests.", ...(briefs.feature ? { brief: { blocks: briefs.feature } } : {}),
  reviews: [
    { id: "api", title: "Store filters", description: "", path: join(directory, "repository"), base: "main", mode: "branch",
      groups: [{ id: "schema", title: "Schema", description: "", targets: [{ path: "src/schema.ts" }] }], ...(briefs.api ? { brief: { blocks: briefs.api } } : {}) },
    { id: "ui", title: "Show saved filters", description: "", path: join(directory, "repository"), base: "main", mode: "branch",
      groups: [{ id: "menu", title: "Menu", description: "", targets: [{ path: "src/menu.tsx" }] }], ...(briefs.ui ? { brief: { blocks: briefs.ui } } : {}) },
  ],
});
const root = fileURLToPath(new URL("..", import.meta.url));
// PORT=1 keeps the CLI's page refresh away from a real Preread server.
const cli = (script: string, ...args: string[]) => promisify(execFile)(join(root, "node_modules", ".bin", "tsx"), [join(root, "scripts", script), ...args],
  { cwd: root, env: { ...process.env, PORT: "1" } }).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
  (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));

test("a review brief has its own file, and writing it leaves the collection, other briefs, and receipts alone", async () => {
  const value = twoReviews("review-storage", { feature: [blocks[0]], api: reviewBlocks("api", "schema") });
  await putCollection(value);
  await setReceipt(value.id, "api", "schema", "reviewed-fingerprint");
  const data = join(directory, "data");
  const file = (...parts: string[]) => readFile(join(data, ...parts), "utf8");
  assert.ok(JSON.parse(await file("collections", "review-storage.json")).reviews.every((review: object) => !("brief" in review)));
  assert.equal((await stat(join(data, "briefs", "review-storage", "api.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(data, "briefs", "review-storage"))).mode & 0o777, 0o700);
  const saved = await Promise.all([file("collections", "review-storage.json"), file("briefs", "review-storage.json"), file("briefs", "review-storage", "api.json")]);
  const receipts = await readReceipts(value.id);
  const uiBrief = { blocks: reviewBlocks("ui", "menu") };
  assert.deepEqual((await putCollectionBrief(value.id, uiBrief, "ui")).reviews[1].brief, uiBrief);
  assert.deepEqual(await Promise.all([file("collections", "review-storage.json"), file("briefs", "review-storage.json"), file("briefs", "review-storage", "api.json")]), saved);
  assert.deepEqual(await readReceipts(value.id), receipts);
  const crossReview = { blocks: reviewBlocks("ui", "menu").map((block) => block.id === "story" ? { ...block, id: "api-story" } : block) };
  await Promise.all([putCollectionBrief(value.id, crossReview, "api"), putCollectionBrief(value.id, { blocks: [blocks[0]] }, "ui")]);
  const current = await readCollection(value.id);
  assert.deepEqual(current.reviews.map((review) => review.brief), [crossReview, { blocks: [blocks[0]] }]);
  assert.deepEqual(current.brief, { blocks: [blocks[0]] });
  await assert.rejects(putCollectionBrief(value.id, uiBrief, "missing"), /No review has the ID “missing”/);
  await assert.rejects(putCollectionBrief(value.id, { blocks: reviewBlocks("api", "missing") }, "ui"), /existing group/);
  assert.deepEqual((await readCollection(value.id)).reviews[1].brief, { blocks: [blocks[0]] });
});
test("imports keep an omitted review brief, replace an included one, and hide one whose review left", async () => {
  const id = "review-imports";
  const value = twoReviews(id);
  await putCollection(twoReviews(id, { api: reviewBlocks("api", "schema"), ui: reviewBlocks("ui", "menu") }));
  await putCollection(value);
  assert.deepEqual((await readCollection(id)).reviews.map((review) => review.brief), [{ blocks: reviewBlocks("api", "schema") }, { blocks: reviewBlocks("ui", "menu") }]);
  await putCollection({ ...value, reviews: [{ ...value.reviews[0], brief: { blocks: [blocks[0]] } }, value.reviews[1]] });
  assert.deepEqual((await readCollection(id)).reviews.map((review) => review.brief), [{ blocks: [blocks[0]] }, { blocks: reviewBlocks("ui", "menu") }]);
  await putCollection({ ...value, reviews: [value.reviews[0]] });
  assert.deepEqual((await readCollection(id)).reviews.map((review) => review.id), ["api"]);
  await stat(join(directory, "data", "briefs", id, "ui.json"));
  await assert.rejects(briefSnapshot(id, "ui"), /not in this collection/);
  await putCollection(value);
  assert.deepEqual((await readCollection(id)).reviews[1].brief, { blocks: reviewBlocks("ui", "menu") });
});
test("review briefs are validated like the feature brief, and a stale link in one brief never blocks writing another", async () => {
  const id = "review-links";
  assert.deepEqual(validateCollection(twoReviews(id, { api: reviewBlocks("ui", "menu") })).reviews[0].brief, { blocks: reviewBlocks("ui", "menu") });
  assert.throws(() => validateCollection(twoReviews(id, { ui: reviewBlocks("ui", "missing") })), /The brief for review “ui”: Brief code reference ui\/missing/);
  assert.throws(() => validateCollection(twoReviews(id, { ui: [{ kind: "visual", id: "chart", visual: { id: "chart", title: "Chart", path: "chart.svg" } }] })), /review “ui”: .*absolute/);
  assert.throws(() => validateCollection(twoReviews(id, { api: [blocks[0], blocks[0]] })), (error: Error) => /"reviews",\s*0,\s*"brief"/.test(error.message) && /unique/.test(error.message));
  assert.throws(() => validateCollection({ ...twoReviews(id), reviews: [{ ...twoReviews(id).reviews[0], brief: { blocks: [blocks[0]], extra: true } }] }));
  await putCollection(twoReviews(id, { api: reviewBlocks("ui", "menu") }));
  const renamed = twoReviews(id);
  renamed.reviews[1].groups[0].id = "picker";
  await putCollection(renamed);
  assert.deepEqual((await readCollection(id)).reviews[0].brief, { blocks: reviewBlocks("ui", "menu") });
  await putCollectionBrief(id, { blocks: [blocks[0]] });
  await putCollectionBrief(id, { blocks: reviewBlocks("ui", "picker") }, "ui");
  await assert.rejects(putCollectionBrief(id, { blocks: reviewBlocks("ui", "menu") }, "api"), /existing group/);
});
test("each brief keeps its own feedback, and every snapshot reports what each brief still asks", async () => {
  const id = "review-feedback";
  await putCollection(twoReviews(id, { feature: featureBlocks, api: reviewBlocks("api", "schema"), ui: reviewBlocks("ui", "menu") }));
  const api = await briefSnapshot(id, "api");
  const open = (review: string) => ({ questions: [{ block: "rollout", question: `Ship ${review} first?` }], approvals: [{ block: "check", title: "Code excerpt" }], comments: 0, feedback: 0 });
  assert.deepEqual(api.attention?.reviews, { api: open("api"), ui: open("ui") });
  assert.deepEqual((await briefSnapshot(id)).attention, api.attention);
  assert.deepEqual(api.attention?.feature?.questions.map((entry) => entry.block), ["sharing"]);
  const answer = { kind: "answer", block: "rollout", revision: api.fingerprints.rollout, answer: { kind: "option", option: "no" } };
  const answered = await saveBriefFeedback(id, answer, "api");
  assert.equal(answered.feedback.length, 1);
  assert.deepEqual(answered.attention?.reviews.api, { ...open("api"), questions: [], feedback: 1 });
  await stat(join(directory, "data", "brief-feedback", id, "reviews", "api", `answer-rollout-${api.fingerprints.rollout}.json`));
  const feature = await briefSnapshot(id);
  assert.equal(feature.feedback.length, 0);
  assert.deepEqual(Object.entries(feature.attention?.reviews ?? {}).filter(([, value]) => value.questions.length).map(([review]) => review), ["ui"]);
  const approved = await saveBriefFeedback(id, { kind: "approve", block: "check", revision: api.fingerprints.check, approved: true }, "api");
  assert.deepEqual(approved.attention?.reviews.api.approvals, []);
  await saveBriefFeedback(id, { kind: "delete", id: `approval-check-${api.fingerprints.check}` }, "api");
  const all = await collectionFeedbackText(id);
  assert.equal(all.entries, 1);
  assert.match(all.text, /^Feature: Saved filters\nBrief revision: [a-f0-9]{64}\n\nNo feedback yet\.\n\nReview: Store filters\n/);
  assert.match(all.text, /\n\nNo feedback on review: Show saved filters$/);
  assert.doesNotMatch(all.text, /Review: Show saved filters/);
  assert.equal((await briefSnapshot(id, "ui")).feedback.length, 0);
  await assert.rejects(saveBriefFeedback(id, answer, "ui"), /changed/);
  const commented = await saveBriefFeedback(id, { kind: "comment", id: randomUUID(), body: "Only the API.", anchor: { kind: "document", revision: api.version, title: "Anything" } }, "api");
  const note = commented.feedback.find((entry) => entry.kind === "comment");
  assert.equal(note?.kind === "comment" && note.anchor.kind === "document" && note.anchor.title, "Store filters");
  await assert.rejects(briefSnapshot(id, "missing"), /not in this collection/);
  await putCollection(twoReviews("review-feedback-none"));
  await assert.rejects(briefSnapshot("review-feedback-none", "api"), /has no brief/);
  assert.match(exportBriefFeedback("Saved filters", answered, "Store filters"), /^Feature: Saved filters\nReview: Store filters\nBrief revision: [a-f0-9]{64}\n\n1\. answer: Ship api first\?\nNo$/);
  assert.match(exportReviewFeedback("Store filters", answered), /^Review: Store filters\nBrief revision: [a-f0-9]{64}\n\n1\. answer/);
});
test("an unreadable part brief or feedback file hides only itself", async () => {
  const id = "unreadable-part";
  await putCollection(twoReviews(id, { feature: featureBlocks, api: reviewBlocks("api", "schema"), ui: reviewBlocks("ui", "menu") }));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const broken = join(directory, "data", "brief-feedback", id, "reviews", "ui");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "broken.json"), "{");
    const api = await briefSnapshot(id, "api");
    assert.deepEqual(Object.keys(api.attention?.reviews ?? {}), ["api"]);
    assert.ok(api.attention?.feature);
    const answered = await saveBriefFeedback(id, { kind: "answer", block: "rollout", revision: api.fingerprints.rollout, answer: { kind: "option", option: "no" } }, "api");
    assert.equal(answered.feedback.length, 1);
    await assert.rejects(briefSnapshot(id, "ui"));
    await writeFile(join(directory, "data", "briefs", id, "ui.json"), "{ not json");
    const current = await readCollection(id);
    assert.equal(current.reviews.find((review) => review.id === "ui")?.brief, undefined);
    assert.ok(current.reviews.find((review) => review.id === "api")?.brief);
    assert.ok(current.brief);
  } finally { console.warn = warn; }
});
test("review brief visuals and comment images are served only through their own brief", async () => {
  const id = "review-assets";
  const source = join(directory, "review.svg");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';
  await writeFile(source, svg);
  await putCollection(twoReviews(id, { feature: featureBlocks, api: [{ kind: "visual", id: "diagram", visual: { id: "diagram", title: "Diagram", path: source } }, blocks[0]] }));
  assert.equal((await readBriefVisual(id, "diagram", "api")).content.toString(), svg);
  await assert.rejects(readBriefVisual(id, "diagram"), /not in the feature brief/);
  await assert.rejects(readBriefVisual(id, "diagram", "ui"), /not in the review brief/);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=", "base64");
  const image = await storeCommentImage(id, "screen.png", png, "api");
  await assert.rejects(storeCommentImage(id, "screen.png", png, "ui"), /has no brief/);
  const comment = randomUUID();
  const { fingerprints } = await briefSnapshot(id, "api");
  await saveBriefFeedback(id, { kind: "comment", id: comment, body: "", attachments: [image.id], anchor: { kind: "block", block: "story", revision: fingerprints.story, title: "Story" } }, "api");
  assert.deepEqual((await readCommentAttachment(id, comment, image.id, "api")).content, png);
  await assert.rejects(readCommentAttachment(id, comment, image.id), /not attached/);
});
test("brief links open a review by itself or one of its groups, with a status only when there is one", () => {
  const html = renderToStaticMarkup(createElement(Markdown, {
    children: "[The API](preread:api), [its schema](preread:api/schema), and [a removed review](preread:gone).",
    onReference: () => {},
    referenceState: (link) => link.review === "gone" ? { kind: "unavailable", message: "This review is no longer in the feature." }
      : link.group ? { kind: "unreviewed", viewed: 0, total: 2 } : undefined,
  }));
  assert.equal(html.match(/class="brief-inline-reference"/g)?.length, 3);
  assert.equal(html.match(/class="brief-group-status/g)?.length, 2);
  assert.match(html, /aria-label="Review: Unavailable. This review is no longer in the feature."/);
  assert.match(html, /aria-label="Code group: Not reviewed/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Markdown, { children: "[One](preread:API) [Two](preread:api/)", onReference: () => {} })), /button|preread:/);
});
test("the collection CLI writes one review's brief and links to it", async () => {
  const manifest = join(directory, "review-cli.json");
  await writeFile(manifest, JSON.stringify(twoReviews("review-cli", { api: reviewBlocks("api", "schema") })));
  const imported = await cli("collections.ts", "import", manifest);
  assert.equal(imported.code, 0, imported.stderr);
  assert.match(imported.stdout, /\?collection=review-cli&review=api&view=brief\n/);
  const brief = join(directory, "ui-brief.json");
  await writeFile(brief, JSON.stringify({ blocks: reviewBlocks("ui", "menu") }));
  const saved = await cli("collections.ts", "brief", "review-cli", "--review", "ui", brief);
  assert.equal(saved.code, 0, saved.stderr);
  assert.match(saved.stdout, /^Saved the brief for Show saved filters in Saved filters; nothing else was changed\.\nhttp:\/\/127\.0\.0\.1:1\/\?collection=review-cli&review=ui&view=brief\n$/);
  assert.deepEqual((await readCollection("review-cli")).reviews[1].brief, { blocks: reviewBlocks("ui", "menu") });
  const unknown = await cli("collections.ts", "brief", "review-cli", "--review", "missing", brief);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /No review has the ID “missing”/);
  for (const args of [["show", "review-cli", "--review", "ui"], ["brief", "review-cli", brief, "--review"]]) {
    const misuse = await cli("collections.ts", ...args);
    assert.equal(misuse.code, 1);
    assert.match(misuse.stdout, /^Usage: pnpm collection brief <id> --review <review-id> <brief.json>/);
  }
});
test("the feedback CLI prints the feature brief, then each review brief with feedback under its title, names the rest, and can show one review", async () => {
  const id = "review-feedback-cli";
  await putCollection(twoReviews(id, { feature: featureBlocks, api: reviewBlocks("api", "schema"), ui: reviewBlocks("ui", "menu") }));
  const feature = await briefSnapshot(id);
  await saveBriefFeedback(id, { kind: "answer", block: "sharing", revision: feature.fingerprints.sharing, answer: { kind: "option", option: "team" } });
  const ui = await briefSnapshot(id, "ui");
  await saveBriefFeedback(id, { kind: "answer", block: "rollout", revision: ui.fingerprints.rollout, answer: { kind: "custom", text: "After the API." } }, "ui");
  const text = await cli("brief-feedback.ts", id);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, new RegExp(["^Feature: Saved filters\nBrief revision: [a-f0-9]{64}\n\n1\\. answer: Who can open it\\?\nMy team",
    "Review: Show saved filters\nBrief revision: [a-f0-9]{64}\n\n1\\. answer: Ship ui first\\?\nAfter the API\\.",
    "No feedback on review: Store filters\n$"].join("\n\n")));
  const json = JSON.parse((await cli("brief-feedback.ts", id, "--json")).stdout);
  assert.equal(json.feedback.length, 1);
  assert.equal("review" in json.feedback[0], false);
  assert.equal("reviewQuestions" in json, false);
  assert.deepEqual(json.reviews.map((entry: { review: string; title: string; feedback: Array<{ review: string }> }) =>
    [entry.review, entry.title, entry.feedback.map((item) => item.review)]), [["api", "Store filters", []], ["ui", "Show saved filters", ["ui"]]]);
  const one = await cli("brief-feedback.ts", id, "--review", "ui");
  assert.match(one.stdout, /^Feature: Saved filters\n\nReview: Show saved filters\n/);
  assert.doesNotMatch(one.stdout, /My team|Store filters/);
  const filtered = JSON.parse((await cli("brief-feedback.ts", id, "--json", "--review", "ui")).stdout);
  assert.deepEqual(filtered.reviews.map((entry: { review: string }) => entry.review), ["ui"]);
  assert.equal(filtered.feedback, undefined);
  const missing = await cli("brief-feedback.ts", id, "--review", "missing");
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /That review is not in this collection/);
  await putCollection(twoReviews("review-feedback-cli-none", { api: reviewBlocks("api", "schema") }));
  assert.equal((await cli("brief-feedback.ts", "review-feedback-cli-none", "--review", "ui")).stdout,
    "Feature: Saved filters\n\nReview: Show saved filters\n\nNo feedback yet.\n");
});
