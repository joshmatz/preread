import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefGroupStatus, groupReadState, type GroupReadState } from "../src/BriefGroupStatus.tsx";
import { Markdown } from "../src/Markdown.tsx";
import type { ProgressSource } from "../src/review-types.ts";

const source = (changes: Partial<ProgressSource["sections"][number]> = {}): ProgressSource => ({
  empty: false,
  sections: [{ id: "query", fingerprint: "current", reviewed: false, changedSinceReview: false, canReview: true,
    files: [{ path: "query.ts", viewHash: "query", patchHash: "query" }, { path: "result.ts", viewHash: "result", patchHash: "result" }], ...changes }],
});
const state = (value: ProgressSource) => groupReadState({ group: "query", source: value });
test("linked groups follow individual Viewed marks without creating group receipts", () => {
  const initial = source();
  assert.deepEqual(state(initial), { kind: "unreviewed", viewed: 0, total: 2 });
  const partial = source({ files: initial.sections[0].files.map((file, index) => ({ ...file, viewed: index === 0 })) });
  assert.deepEqual(state(partial), { kind: "partial", viewed: 1, total: 2 });
  const complete = source({ files: initial.sections[0].files.map((file) => ({ ...file, viewed: true })) });
  assert.deepEqual(state(complete), { kind: "reviewed", viewed: 2, total: 2 });
  assert.equal(complete.sections[0].reviewed, false);
  assert.deepEqual(state(initial), { kind: "unreviewed", viewed: 0, total: 2 });
});
test("a changed group reopens and completes again when its current changes are viewed", () => {
  const changed = source({ changedSinceReview: true });
  assert.deepEqual(state(changed), { kind: "changed", viewed: 0, total: 2 });
  assert.deepEqual(state(source({ changedSinceReview: true, files: changed.sections[0].files.map((file) => ({ ...file, viewed: true })) })),
    { kind: "reviewed", viewed: 2, total: 2 });
});
test("an explicit unmark overrides a group receipt and unavailable changes cannot look reviewed", () => {
  const reviewed = source({ reviewed: true });
  assert.equal(state(reviewed).kind, "reviewed");
  assert.deepEqual(state(source({ reviewed: true, files: reviewed.sections[0].files.map((file, index) => ({ ...file, viewed: index === 0 })) })),
    { kind: "partial", viewed: 1, total: 2 });
  assert.equal(state(source({ reviewed: true, canReview: false })).kind, "attention");
  assert.equal(state(source({ files: [] })).kind, "attention");
});
test("checking, failed checks, and removed groups are distinct from unread code", () => {
  assert.deepEqual(groupReadState({ group: "query" }), { kind: "checking" });
  const unavailable = groupReadState({ group: "query", source: source({ reviewed: true }), progress: {
    status: "unavailable", error: "Worktree missing", reviewedGroups: 0, totalGroups: 0, changedGroups: 0, attentionGroups: 0,
  } });
  assert.deepEqual(unavailable, { kind: "unavailable", message: "Worktree missing" });
  assert.equal(groupReadState({ group: "removed", source: source() }).kind, "unavailable");
});
test("group status is accessible without changing the passage text used by annotations", () => {
  const text = "Read [the query](preread:implementation/query), then leave a comment.";
  const render = (status?: GroupReadState) => renderToStaticMarkup(createElement(Markdown, {
    children: text, onReference: () => {}, referenceState: status ? () => status : undefined,
  }));
  const baseline = render();
  const unread = render({ kind: "unreviewed", viewed: 0, total: 2 });
  const reviewed = render({ kind: "reviewed", viewed: 2, total: 2 });
  assert.match(unread, /data-label="Not reviewed"/);
  assert.match(reviewed, /role="img" aria-label="Code group: Reviewed\./);
  const passage = (html: string) => html.replace(/<[^>]*>/g, "");
  assert.equal(passage(unread), passage(baseline));
  assert.equal(passage(reviewed), passage(baseline));
  const partial = renderToStaticMarkup(createElement(BriefGroupStatus, { state: { kind: "partial", viewed: 1, total: 2 } }));
  assert.match(partial, /data-label="1\/2 viewed"/);
});
