import test from "node:test";
import assert from "node:assert/strict";
import { briefStructure } from "../src/brief-outline.ts";
import { partTree } from "../src/part-tree.ts";
import type { BriefBlock } from "../src/brief-types.ts";

const markdown = (id: string, text: string): BriefBlock => ({ id, kind: "markdown", markdown: text });
const tree = (blocks: BriefBlock[], groups: string[]) => {
  const result = partTree("menus", groups, briefStructure({ blocks }));
  return { ...result, headings: Object.fromEntries(result.headings) };
};

test("each group lists under the first heading that links it, and unlinked groups under Other code", () => {
  const source = [
    "Before any heading, see [the list](preread:menus/list).", "",
    "## Menus", "", "[Menus](preread:menus/menu) and [the list](preread:menus/list).", "",
    "### Escape after a click", "", "[Again](preread:menus/menu), [placement](preread:menus/placement).", "",
    "## Popovers", "", "[Menus](preread:menus/menu), [another part](preread:buttons/menu), [gone](preread:menus/gone).",
  ].join("\n");
  assert.deepEqual(tree([markdown("a", source)], ["menu", "list", "placement", "tests"]), {
    lead: ["list"],
    headings: { "a:0": ["menu", "placement"] },
    other: ["tests"],
  });
});

test("a code excerpt links its group from the section it sits in", () => {
  const blocks: BriefBlock[] = [
    markdown("intro", "## Menus"),
    { id: "excerpt", kind: "code", language: "ts", code: "open()", approval: false, reference: { review: "menus", group: "menu" } },
    markdown("later", "## Tests\n\n[Tests](preread:menus/tests)"),
  ];
  assert.deepEqual(tree(blocks, ["menu", "tests", "other-changes"]), {
    lead: [], headings: { "intro:0": ["menu"], "later:0": ["tests"] }, other: ["other-changes"],
  });
});

test("a part whose overview has no headings lists its groups in the code's order", () => {
  assert.deepEqual(tree([markdown("a", "See [tests](preread:menus/tests) and [menus](preread:menus/menu).")], ["menu", "tests"]),
    { lead: ["menu", "tests"], headings: {}, other: [] });
  assert.deepEqual(tree([], ["menu"]), { lead: ["menu"], headings: {}, other: [] });
});
