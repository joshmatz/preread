import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectionProgress,
  reviewProgress,
  progressLabel,
  progressSource,
  progressFromSource,
  withFileViews,
  type ViewedReader,
} from "../src/progress.ts";
import { groupPreviews } from "../server/review.ts";
import type { FilePreview, ReviewSnapshot } from "../src/review-types.ts";

const file: FilePreview = {
  file: { path: "example.ts", status: "M", additions: 2, deletions: 2, binary: false },
  partial: false,
  diff: {
    patch:
      "diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-old\n+new\n@@ -40 +40 @@\n-old second\n+new second\n",
    hash: "fixture",
    binary: false,
    tooLarge: false,
    empty: false,
  },
};
const scope = { id: "example", path: "/tmp/fixture", base: "main", mode: "branch" as const };
const groups = [
  {
    id: "first",
    title: "First change",
    description: "",
    targets: [{ path: "example.ts", ranges: [{ side: "new" as const, start: 1, end: 1 }] }],
  },
];
const comparison = {
  base: "main",
  baseSha: "base",
  mergeBase: "base",
  head: "head",
  files: [file.file],
  commits: [],
  commitCount: 1,
  version: "fixture",
  warnings: [],
};
const initial = groupPreviews([file], groups, {}, scope);
const receipt = (id: string) => ({
  fingerprint: initial.find((section) => section.id === id)!.fingerprint,
  reviewedAt: "2026-09-20T00:00:00Z",
});
const makeSnapshot = (receipts = {}) => ({
  comparison,
  sections: groupPreviews([file], groups, receipts, scope),
});

test("item completion includes unassigned blocks rather than just declared groups", () => {
  const partial = reviewProgress(makeSnapshot({ "example/first": receipt("first") }));
  assert.equal(partial.reviewedGroups, 1);
  assert.equal(partial.totalGroups, 2);
  assert.equal(partial.status, "partial");
  const full = reviewProgress(
    makeSnapshot({
      "example/first": receipt("first"),
      "example/other-changes": receipt("other-changes"),
    }),
  );
  assert.equal(full.status, "reviewed");
  assert.equal(collectionProgress([full, partial]).complete, false);
  assert.equal(collectionProgress([full, full]).reviewedItems, 2);
  assert.equal(collectionProgress([full, full]).complete, true);
});
test("a changed reviewed block reopens its item and the collection", () => {
  const changed = {
    ...file,
    diff: { ...file.diff, patch: file.diff.patch.replace("+new\n", "+changed\n") },
  };
  const sections = groupPreviews(
    [changed],
    groups,
    { "example/first": receipt("first"), "example/other-changes": receipt("other-changes") },
    scope,
  );
  const result = reviewProgress({ comparison, sections });
  assert.equal(result.status, "changed");
  assert.equal(result.reviewedGroups, 1);
  assert.equal(result.changedGroups, 1);
  assert.equal(collectionProgress([result]).complete, false);
  assert.match(progressLabel(result), /changed since review/);
});
test("unchecked, failed, and blocked items never make a collection look complete", () => {
  const full = reviewProgress(
    makeSnapshot({
      "example/first": receipt("first"),
      "example/other-changes": receipt("other-changes"),
    }),
  );
  assert.equal(collectionProgress([full, undefined]).complete, false);
  assert.equal(collectionProgress([full, undefined]).checkingItems, 1);
  assert.equal(
    collectionProgress([full, { ...full, status: "unavailable", error: "Missing worktree" }])
      .complete,
    false,
  );
  const blocked = reviewProgress({
    ...makeSnapshot(),
    sections: [
      { ...initial[0], reviewed: true, canReview: false, warnings: ["Missing assignment"] },
    ],
  });
  assert.equal(blocked.status, "attention");
  assert.equal(blocked.reviewedGroups, 0);
});
test("empty items are labeled separately, but stale assignments still need attention", () => {
  const empty: ReviewSnapshot = {
    comparison: { ...comparison, files: [] },
    sections: groupPreviews([], [], {}, scope),
  };
  const result = reviewProgress(empty);
  assert.equal(result.status, "empty");
  assert.equal(result.totalGroups, 0);
  assert.equal(collectionProgress([result]).complete, true);
  assert.equal(collectionProgress([result]).reviewedItems, 0);
  assert.equal(collectionProgress([result]).emptyItems, 1);
  const missing = reviewProgress({ ...empty, sections: groupPreviews([], groups, {}, scope) });
  assert.equal(missing.status, "attention");
  assert.equal(collectionProgress([missing]).complete, false);
});

test("individual viewed blocks complete their groups and collection without group receipts", () => {
  const snapshot = makeSnapshot();
  const viewed = new Set<string>();
  const read: ViewedReader = (file, fallback) => viewed.has(file.viewHash) || fallback;
  viewed.add(snapshot.sections[0].files[0].viewHash!);
  const partial = withFileViews(snapshot, read);
  assert.equal(reviewProgress(partial).reviewedGroups, 1);
  assert.equal(
    partial.sections[1].reviewed,
    false,
    "other blocks in the same file still need viewing",
  );
  viewed.add(snapshot.sections[1].files[0].viewHash!);
  const full = withFileViews(snapshot, read);
  assert.equal(reviewProgress(full).reviewedGroups, 2);
  assert.equal(collectionProgress([reviewProgress(full)]).complete, true);
  assert.equal(snapshot.sections[0].reviewed, false, "deriving progress never creates a receipt");
  assert.deepEqual(
    progressFromSource(progressSource(snapshot), read),
    reviewProgress(full),
    "background progress uses the same file state",
  );
});

test("an unchecked file overrides a bulk receipt and immediately reopens collection progress", () => {
  const snapshot = makeSnapshot({
    "example/first": receipt("first"),
    "example/other-changes": receipt("other-changes"),
  });
  const unchecked = snapshot.sections[0].files[0].viewHash;
  const read: ViewedReader = (file, fallback) =>
    file.viewHash === unchecked ? false : fallback;
  const progress = progressFromSource(progressSource(snapshot), read);
  assert.equal(progress.reviewedGroups, 1);
  assert.equal(progress.status, "partial");
  assert.equal(collectionProgress([progress]).complete, false);
});

test("changed files reopen while existing viewed files and unrelated groups remain complete", () => {
  const snapshot = makeSnapshot();
  const viewed = new Set(
    snapshot.sections.flatMap((section) => section.files.map((preview) => preview.viewHash)),
  );
  const changed = {
    ...file,
    diff: { ...file.diff, patch: file.diff.patch.replace("+new\n", "+newer\n") },
  };
  const updated = { comparison, sections: groupPreviews([changed], groups, {}, scope) };
  const result = withFileViews(updated, (file) => viewed.has(file.viewHash));
  assert.equal(result.sections[0].reviewed, false);
  assert.equal(result.sections[1].reviewed, true);
  assert.equal(reviewProgress(result).reviewedGroups, 1);
});

test("viewing all files cannot complete unavailable groups, but resolves stale status once reviewable", () => {
  const snapshot = makeSnapshot();
  const blocked = {
    ...snapshot,
    sections: snapshot.sections.map((section) => ({
      ...section,
      canReview: false,
      warnings: ["Unavailable preview"],
    })),
  };
  assert.equal(reviewProgress(withFileViews(blocked, () => true)).reviewedGroups, 0);
  const stale = {
    ...snapshot,
    sections: snapshot.sections.map((section) => ({ ...section, changedSinceReview: true })),
  };
  assert.equal(reviewProgress(withFileViews(stale, () => true)).status, "reviewed");
  assert.equal(progressFromSource(progressSource(stale), () => true).changedGroups, 0);
});
