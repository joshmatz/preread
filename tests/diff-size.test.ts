import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSize } from "../src/diff-size.ts";
const patch = (rows: string[]) => "diff --git a/code.ts b/code.ts\n--- a/code.ts\n+++ b/code.ts\n@@ -1 +1 @@\n" + rows.join("\n") + "\n";
test("500 diff rows require an explicit load, including deleted and context rows", () => {
  assert.equal(diffSize(patch(Array(499).fill("+new"))).deferred, false);
  const size = diffSize(patch([...Array(250).fill("-old"), ...Array(249).fill("+new"), " context"]));
  assert.equal(size.lines, 500);
  assert.equal(size.deferred, true);
});
test("a small hunk in a long source file still renders automatically", () => {
  const size = diffSize("diff --git a/code.ts b/code.ts\n--- a/code.ts\n+++ b/code.ts\n@@ -15000 +15000 @@\n-old\n+new\n\\ No newline at end of file\n");
  assert.equal(size.lines, 2);
  assert.equal(size.deferred, false);
});
test("large single-line and multibyte diffs also require an explicit load", () => {
  assert.equal(diffSize(patch(["+" + "a".repeat(102400)])).deferred, true);
  assert.equal(diffSize(patch(["+" + "é".repeat(51200)])).deferred, true);
  assert.equal(diffSize("").deferred, false);
});
