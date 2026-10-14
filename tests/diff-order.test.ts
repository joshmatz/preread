import assert from "node:assert/strict";
import { test } from "node:test";
import { html, parse } from "diff2html";
import { orderUnifiedChanges } from "../src/diff-order.ts";

const header = "diff --git a/code.ts b/code.ts\n--- a/code.ts\n+++ b/code.ts\n";
const replacement = [
  "@@ -1,4 +1,4 @@",
  " const commonActions = [",
  '-  formatActionForPrompt("claims/getClaimDetails"),',
  '-  formatActionForPrompt("claims/updateClaimStatus"),',
  "+  // Keep the prefix cached.",
  "+  const actions = common.map(formatActionForPrompt);",
  " ];",
].join("\n") + "\n";

// Exercise real renderer output with just the DOM operations used by the helper.
function fixture(patch: string, split = false) {
  const rendered = html(patch, {
    matching: "lines", outputFormat: split ? "side-by-side" : "line-by-line", drawFileList: false,
  });
  const bodies = [...rendered.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)].map(([, html]) => {
    const rows = [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(([html]) => ({
      html,
      type: /<td class="[^"]*\bd2h-del\b/.test(html) ? "delete"
        : /<td class="[^"]*\bd2h-ins\b/.test(html) ? "insert"
        : /\bd2h-info\b/.test(html) ? "header" : "context",
      querySelector(selector: string) {
        return this.type === (selector === "td.d2h-del" ? "delete" : "insert") ? {} : null;
      },
    }));
    return {
      rows,
      querySelectorAll() { return [...rows]; },
      insertBefore(row: typeof rows[number], before: typeof rows[number]) {
        rows.splice(rows.indexOf(row), 1);
        rows.splice(rows.indexOf(before), 0, row);
      },
    };
  });
  const root = {
    querySelectorAll(selector: string) {
      assert.equal(selector, ".d2h-file-diff .d2h-diff-tbody");
      return split ? [] : bodies;
    },
  } as unknown as HTMLElement;
  return { root, bodies };
}

test("unified replacements follow patch order while retaining matched word highlights", () => {
  const patch = header + replacement;
  const { root, bodies: [body] } = fixture(patch);
  const originalRows = [...body.rows];
  const expected = ["header", ...parse(patch)[0].blocks[0].lines.map((line) => line.type)];
  assert.notDeepEqual(body.rows.map((row) => row.type), expected, "fixture must reproduce reordered rows");
  orderUnifiedChanges(root);
  assert.deepEqual(body.rows.map((row) => row.type), expected);
  assert.deepEqual(new Set(body.rows), new Set(originalRows), "every original row is retained");
  assert.ok(body.rows.some((row) => row.html.includes("<del>")));
  assert.ok(body.rows.some((row) => row.html.includes("<ins>")));
  orderUnifiedChanges(root);
  assert.deepEqual(body.rows.map((row) => row.type), expected);
});

test("context lines, hunk headers and separate file tables keep their boundaries", () => {
  const patch = header + replacement + "@@ -20,4 +20,4 @@\n" + replacement.split("\n").slice(1).join("\n");
  const another = (header + replacement).replaceAll("code.ts", "other.ts");
  const { root, bodies } = fixture(patch + another);
  orderUnifiedChanges(root);
  const expected = parse(patch + another).map((file) => file.blocks.flatMap((block) =>
    ["header", ...block.lines.map((line) => line.type)]));
  assert.deepEqual(bodies.map((body) => body.rows.map((row) => row.type)), expected);
});

test("pure additions and deletions keep their source order", () => {
  for (const patch of [
    header + "@@ -0,0 +1,2 @@\n+one\n+two\n",
    header + "@@ -1,2 +0,0 @@\n-one\n-two\n",
  ]) {
    const { root, bodies: [body] } = fixture(patch);
    const before = [...body.rows];
    orderUnifiedChanges(root);
    assert.deepEqual(body.rows, before);
  }
});

test("split view keeps matched rows and placeholders aligned", () => {
  const { root, bodies } = fixture(header + replacement, true);
  const before = bodies.map((body) => [...body.rows]);
  orderUnifiedChanges(root);
  assert.deepEqual(bodies.map((body) => body.rows), before);
});
