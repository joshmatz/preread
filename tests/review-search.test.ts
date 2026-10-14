import assert from "node:assert/strict";
import { test } from "node:test";
import { indexSearch, searchIndex } from "../src/review-search.ts";
const patch = "diff --git a/header-only-key.ts b/header-only-key.ts\n--- a/header-only-key.ts\n+++ b/header-only-key.ts\n@@ -8,2 +8,2 @@\n-OLD Secret\n+new secret\n context\n";
const index = indexSearch([{ key: "one", path: "src/new-name.ts", oldPath: "src/old-name.ts", patch }, { key: "large", path: "schema.json", patch: "diff --git a/schema.json b/schema.json\n--- /dev/null\n+++ b/schema.json\n@@ -0,0 +1,10000 @@\n" + Array.from({ length: 10000 }, (_, i) => `+value ${i === 9900 ? "UNLOADED_NEEDLE" : i}`).join("\n") }]);
test("file search includes renamed paths and content search excludes patch headers", () => {
  assert.equal(searchIndex(index, "old-name", "files")[0].key, "one");
  assert.deepEqual(searchIndex(index, "header-only-key", "contents"), []);
  assert.deepEqual(searchIndex(index, "secret", "files"), []);
});
test("content search finds old, new and context lines with original coordinates", () => {
  const result = searchIndex(index, "SECRET", "contents")[0];
  assert.equal(result.count, 2);
  assert.deepEqual(result.matches.map(({ side, line }) => ({ side, line })), [{ side: "old", line: 8 }, { side: "new", line: 8 }]);
  assert.equal(searchIndex(index, "context", "contents")[0].matches[0].line, 9);
});
test("search covers unloaded large diffs and points at the correct bounded chunk", () => {
  const result = searchIndex(index, "unloaded_needle", "all")[0];
  assert.equal(result.key, "large");
  assert.equal(result.matches[0].line, 9901);
  assert.equal(result.matches[0].chunk, 33);
});
test("search treats special characters literally and bounds excerpts without hiding counts", () => {
  const entries = indexSearch([{ key: "literal", path: "code.ts", patch: "@@ -0,0 +1,10 @@\n" + Array(10).fill("+" + "x".repeat(500) + "[a.*]").join("\n") }]);
  const result = searchIndex(entries, "[a.*]", "contents")[0];
  assert.equal(result.count, 10);
  assert.equal(result.matches.length, 3);
  assert.ok(result.matches.every((match) => match.text.includes("[a.*]") && match.text.length < 190));
});
test("type-change search ignores later file headers and opens the actual addition chunk", () => {
  const removal = "diff --git a/file b/file\ndeleted file mode 100644\n--- a/file\n+++ /dev/null\n@@ -1,350 +0,0 @@\n" + Array.from({ length: 350 }, (_, i) => `-old ${i}`).join("\n") + "\n";
  const addition = "diff --git a/file b/file\nnew file mode 120000\n--- /dev/null\n+++ b/file\n@@ -0,0 +1 @@\n+unique_target\n";
  const entries = indexSearch([{ key: "type", path: "file", patch: removal + addition }]);
  assert.deepEqual(searchIndex(entries, "/dev/null", "contents"), []);
  const result = searchIndex(entries, "unique_target", "contents")[0];
  assert.equal(result.matches[0].chunk, 2);
  assert.equal(result.matches[0].line, 1);
  assert.equal(result.matches[0].side, "new");
});
