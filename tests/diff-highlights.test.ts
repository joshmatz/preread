import assert from "node:assert/strict";
import { test } from "node:test";
import { html } from "diff2html";
import { relatedChanges } from "../src/diff-highlights.ts";

const header = "diff --git a/code.ts b/code.ts\n--- a/code.ts\n+++ b/code.ts\n";
const decode = (html: string) => html.replace(/<[^>]*>/g, "")
  .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function renderedChanges(patch: string, split = false) {
  const output = html(header + patch, {
    matching: "lines", drawFileList: false, outputFormat: split ? "side-by-side" : "line-by-line",
  });
  const before: { text: string; unchanged: string }[] = [];
  const after: typeof before = [];
  for (const [row] of output.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
    const content = /<span class="d2h-code-line-ctn">([\s\S]*?)<\/span>/.exec(row)?.[1];
    if (!content) continue;
    const lines = /<td class="[^"]*\bd2h-del\b/.test(row) ? before
      : /<td class="[^"]*\bd2h-ins\b/.test(row) ? after : null;
    if (lines) lines.push({ text: decode(content), unchanged: row.includes("d2h-change")
      ? decode(content.replace(/<(ins|del)>[\s\S]*?<\/\1>/g, "")) : "" });
  }
  return { before, after };
}

test("a rewritten block stays a whole-block change despite a similar final line", () => {
  const patch = [
    "@@ -1,5 +1,5 @@",
    '-  formatActionForPrompt("claims/getClaimDetails"),',
    '-  formatActionForPrompt("instructions/updateInstructions"),',
    '-  formatActionForPrompt("search/searchWeb"),',
    "-    .filter(Boolean)",
    "-    .join('\\n\\n')",
    "+  // Keep the prefix cached.",
    "+  const commonActions = common.map((action) => formatActionForPrompt(action.actionId));",
    "+  const otherActions = Object.values(groupBy(others, (action) => action.actionId.split('/')[0]));",
    "+    .map((group) => group.map((action) => action.actionId))",
    "+    .join('\\n')",
  ].join("\n") + "\n";
  for (const split of [false, true]) {
    const { before, after } = renderedChanges(patch, split);
    assert.equal(before.length, 5);
    assert.equal(after.length, 5);
    assert.equal(relatedChanges(before, after), false);
    assert.equal(relatedChanges(before.slice(-1), after.slice(-1)), true);
  }
});

test("a focused identifier or numeric edit retains word highlights", () => {
  for (const [beforeLine, afterLine] of [
    ["const timeout = 1000;", "const timeout = 2000;"],
    ["return formatActionForPrompt(action.id);", "return formatActionForPrompt(action.actionId);"],
    ["return formatActionForPrompt(action.id);", "  return formatActionForPrompt(action.id);"],
    ["const 状態 = 有効;", "const 状態 = 無効;"],
  ]) {
    const { before, after } = renderedChanges(`@@ -1 +1 @@\n-${beforeLine}\n+${afterLine}\n`);
    assert.equal(relatedChanges(before, after), true, `${beforeLine} → ${afterLine}`);
  }
});

test("shared punctuation and indentation don't imply meaningful overlap", () => {
  const { before, after } = renderedChanges("@@ -1 +1 @@\n-  fetchClaims();\n+  saveInstructions();\n");
  assert.equal(relatedChanges(before, after), false);
  assert.equal(relatedChanges([{ text: "  []()", unchanged: "  []()" }],
    [{ text: "  []()", unchanged: "  []()" }]), false);
});

test("a small fragment of an otherwise rewritten line doesn't get word highlights", () => {
  const { before, after } = renderedChanges("@@ -1 +1 @@\n-return result;\n+return Object.values(groupBy(actions, action => action.namespace)).map(formatGroup);\n");
  assert.equal(relatedChanges(before, after), false);
  assert.equal(relatedChanges([], after), false);
  assert.equal(relatedChanges(before, []), false);
});
