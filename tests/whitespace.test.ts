import assert from "node:assert/strict";
import { test } from "node:test";
import { createTwoFilesPatch } from "diff";
import { whitespaceDiff } from "../src/whitespace-diff.ts";
import { createContextModel, expandContext, contextPatch } from "../src/diff-context.ts";
import { parsePatch, patchFor } from "../server/patches.ts";

const patch = (before: string, after: string, context = 3) =>
  createTwoFilesPatch("a/example.ts", "b/example.ts", before, after, "", "", { context });
const rows = (value: string) =>
  whitespaceDiff(value).flatMap((file) => file.blocks.flatMap((block) => block.lines));

test("ignoring spacing keeps real edits and accurate line numbers beside indentation changes", () => {
  const result = rows(
    patch(
      "function example() {\n  keep();\n  oldCall();\n}\n",
      "function example(){\n\tkeep( );  \n\tnewCall();\n}\n",
    ),
  );
  assert.deepEqual(
    result.filter((line) => line.type !== "context").map((line) => line.content),
    ["-  oldCall();", "+\tnewCall();"],
  );
  const kept = result.find((line) => line.content.includes("keep"))!;
  assert.equal(kept.type, "context");
  assert.equal(kept.oldNumber, 2);
  assert.equal(kept.newNumber, 2);
});

test("spacing-only blocks show a notice without removing the file or mutating the canonical patch", () => {
  const original = patch("const value = 1;\n", "  const value=1;\t\n");
  const result = whitespaceDiff(original);
  assert.equal(result.length, 1);
  assert.equal(result[0].blocks[0].lines.length, 0);
  assert.match(result[0].blocks[0].header, /Whitespace-only changes hidden/);
  assert.match(original, /-const value = 1;/);
});

test("added blank lines and end-of-file newline changes remain visible", () => {
  const blank = rows(patch("first\nlast\n", "first\n\nlast\n"));
  assert.equal(blank.filter((line) => line.type === "insert").length, 1);
  assert.equal(blank.at(-1)?.oldNumber, 2);
  assert.equal(blank.at(-1)?.newNumber, 3);
  assert.equal(rows(patch("last", " last ")).length, 0);
  const eof = rows(patch("last", "last\n"));
  assert.deepEqual(
    eof.map((line) => line.type),
    ["delete", "insert"],
  );
});

test("selected groups and expanded context retain their boundaries while ignoring whitespace", () => {
  const before = Array.from({ length: 80 }, (_, index) => `line ${index + 1}\n`);
  const after = [...before];
  after[10] = "   line 11\n";
  after[12] = "updated 13\n";
  after[60] = "another group's change\n";
  const original = patch(before.join(""), after.join(""));
  const full = patch(before.join(""), after.join(""), 100);
  const parsed = parsePatch(original);
  const selected = patchFor(parsed.header, [parsed.hunks[0]]);
  const model = expandContext(createContextModel(selected, full), 0, "above");
  const displayed = rows(contextPatch(model));
  assert.equal(displayed[0].oldNumber, 1);
  assert.equal(displayed.find((line) => line.content.includes("line 11"))?.type, "context");
  assert.ok(
    displayed.some((line) => line.type === "insert" && line.content.includes("updated 13")),
  );
  assert.ok(displayed.every((line) => !line.content.includes("another group's change")));
});
