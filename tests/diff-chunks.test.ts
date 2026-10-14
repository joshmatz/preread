import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "diff2html";
import { diffChunks, DIFF_CHUNK_ROWS } from "../src/diff-chunks.ts";
const header = "diff --git a/code.ts b/code.ts\n--- a/code.ts\n+++ b/code.ts\n";
function rows(patch: string) { return parse(patch)[0].blocks.flatMap((block) => block.lines).map((line) => [line.content, line.oldNumber, line.newNumber]); }
test("chunking a large addition preserves every source line and its coordinates", () => {
  const patch = header + "@@ -0,0 +1,2000 @@\n" + Array.from({ length: 2000 }, (_, i) => `+new ${i}`).join("\n") + "\n";
  const chunks = diffChunks(patch);
  assert.equal(chunks.length, 7);
  assert.deepEqual(chunks.flatMap(rows), rows(patch));
  assert.ok(chunks.every((chunk) => rows(chunk).length <= DIFF_CHUNK_ROWS));
});
test("chunking deletion, insertion and distant hunks preserves old/new lines and missing newline markers", () => {
  const patch = header + "@@ -10,351 +11,351 @@\n" + " context\n" + Array.from({ length: 350 }, (_, i) => `-old ${i}`).join("\n") + "\n" + Array.from({ length: 350 }, (_, i) => `+new ${i}`).join("\n") + "\n\\ No newline at end of file\n@@ -900,0 +901,1 @@\n+last\n";
  assert.deepEqual(diffChunks(patch).flatMap(rows), rows(patch));
  assert.ok(diffChunks(patch).some((chunk) => chunk.includes("No newline at end of file")));
});
test("small diffs and non-text previews are preserved exactly", () => {
  for (const patch of [header + "@@ -1 +1 @@ description\n-old\n+new\n", "Binary files differ", ""]) assert.deepEqual(diffChunks(patch), [patch]);
});
test("large type changes keep each file section's header and source coordinates", () => {
  const removal = "diff --git a/code.ts b/code.ts\ndeleted file mode 100644\n--- a/code.ts\n+++ /dev/null\n@@ -1,350 +0,0 @@\n" + Array.from({ length: 350 }, (_, i) => `-old ${i}`).join("\n") + "\n";
  const addition = "diff --git a/code.ts b/code.ts\nnew file mode 120000\n--- /dev/null\n+++ b/code.ts\n@@ -0,0 +1 @@\n+target\n";
  const sourceRows = (patch: string) => parse(patch).flatMap((file) => file.blocks.flatMap((block) => block.lines.map((line) => [file.oldName, file.newName, line.content, line.oldNumber, line.newNumber])));
  const chunks = diffChunks(removal + addition);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.flatMap(sourceRows), sourceRows(removal + addition));
  assert.ok(chunks.every((chunk) => sourceRows(chunk).length <= DIFF_CHUNK_ROWS));
  const small = removal.replace("-1,350", "-1,1").replace(/-old 1\n[\s\S]*/, "") + addition;
  assert.deepEqual(diffChunks(small), [small]);
});
