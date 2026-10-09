import assert from "node:assert/strict";
import { test } from "node:test";
import { displaySections } from "../src/review-display.ts";
import { markedFile, progressSource, reviewProgress } from "../src/progress.ts";
import type { FilePreview, ReviewSection, ReviewSnapshot } from "../src/review-types.ts";

const preview = (path: string, oldPath?: string): FilePreview => ({
  file: { path, oldPath, status: oldPath ? "R" : "M", additions: 1, deletions: 1, binary: false },
  partial: false,
  diff: { patch: "", hash: path, binary: false, tooLarge: false, empty: false },
});
const section = (files: FilePreview[], id = "mixed"): ReviewSection => ({
  id,
  title: id,
  description: "",
  files,
  fingerprint: id,
  reviewed: false,
  changedSinceReview: false,
  canReview: true,
  warnings: [],
});

test("hiding tests keeps production changes visible, including code moved out of tests", () => {
  const files = [
    preview("src/worker.ts"),
    preview("src/worker.inttest.ts"),
    preview("tests/worker.ts"),
    preview("tests/fixtures/before.png"),
    preview("tests/fixture/pnpm-lock.yaml"),
    preview("src/RetryBadge.ui.test.tsx"),
    preview("docs/specs/api.md"),
    preview("src/helper.ts", "tests/helper.ts"),
    preview("tests/support.ts", "src/support.ts"),
  ];
  const groups = [section(files)];
  assert.deepEqual(
    displaySections(groups, true)[0].files.map(({ file }) => file.path),
    ["src/worker.ts", "docs/specs/api.md", "src/helper.ts"],
  );
  assert.equal(displaySections(groups, false)[0].files, files);
  assert.equal(groups[0].files.length, 9);
});

test("test-only groups keep their identity, progress, and complete mark-all selection", () => {
  const groups = [section([preview("tests/worker.ts"), preview("src/worker.spec.ts")], "tests")];
  const snapshot: ReviewSnapshot = {
    comparison: {
      base: "main",
      baseSha: "base",
      mergeBase: "base",
      head: "head",
      files: groups[0].files.map(({ file }) => file),
      commits: [],
      commitCount: 0,
      version: "fixture",
      warnings: [],
    },
    sections: groups,
  };
  const before = progressSource(snapshot);
  const displayed = displaySections(groups, true);
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].files.length, 0);
  assert.equal(displayed[0].section, groups[0]);
  assert.deepEqual(displayed[0].section.files.map(markedFile), before.sections[0].files);
  assert.deepEqual(progressSource(snapshot), before);
  assert.equal(reviewProgress(snapshot).status, "unreviewed");
  assert.deepEqual(displaySections(groups, false)[0].files, groups[0].files);
});
