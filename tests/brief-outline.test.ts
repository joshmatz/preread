import test from "node:test";
import assert from "node:assert/strict";
import { blockTargets, briefOutline, briefStructure, parseMarkdown } from "../src/brief-outline.ts";
import type { BriefBlock } from "../src/brief-types.ts";

const brief = (blocks: BriefBlock[]) => ({ blocks });
const markdown = (id: string, text: string): BriefBlock => ({ id, kind: "markdown", markdown: text });

test("contents entries are the headings the page renders at the top level, in the same order", () => {
  const source = [
    "# Where it stands", "", "Intro", "", "## Save a **filter** with `canSaveFilters`", "", "```md", "## Not a heading", "```", "",
    "### The [billing](preread:billing/words) words", "", "#### Too deep", "", "  ## Indented up to three spaces", "",
    "Underlined", "==========", "", "##", "", "> ## Quoted", "", "- ## In a list", "", "##No space", "", "~~~~", "# Fenced", "~~~~", "", "### Last ###",
  ].join("\n");
  assert.deepEqual(parseMarkdown(source).headings, [
    { index: 0, level: 2, text: "Where it stands", line: "Where it stands", repeat: 0 }, { index: 1, level: 2, text: "Save a filter with canSaveFilters", line: "Save a filter with canSaveFilters", repeat: 0 },
    { index: 2, level: 3, text: "The billing words", line: "The billing ↗ words", repeat: 0 }, { index: 3, level: 2, text: "Indented up to three spaces", line: "Indented up to three spaces", repeat: 0 },
    { index: 4, level: 2, text: "Underlined", line: "Underlined", repeat: 0 }, { index: 6, level: 3, text: "Last", line: "Last", repeat: 0 },
  ]);
  assert.deepEqual(briefOutline(brief([markdown("a", "## One\n\n### Two"), { id: "q", kind: "question", question: "Q?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] }, markdown("b", "## Three")])),
    [{ key: "a:0", block: "a", index: 0, level: 2, text: "One", line: "One", repeat: 0 }, { key: "a:1", block: "a", index: 1, level: 3, text: "Two", line: "Two", repeat: 0 },
      { key: "b:0", block: "b", index: 0, level: 2, text: "Three", line: "Three", repeat: 0 }]);
});

test("code links come from rendered links, including reference links, and never from code", () => {
  assert.deepEqual(parseMarkdown([
    "See [the queue](preread:api/queue), [the menu][menu], and [a page](https://example.com).",
    "`[not a link](preread:api/code)`", "", "```", "[nor this](preread:api/fence)", "```", "", "[menu]: preread:ui/menu",
  ].join("\n")).targets, [{ review: "api", group: "queue" }, { review: "ui", group: "menu" }]);
});

test("sections run between top-level headings, collect each code group once, and end at their last block", () => {
  const blocks: BriefBlock[] = [
    markdown("status", "Nothing is pushed. See [the API](preread:api)."),
    markdown("send", "## Send\n\nRead [the queue](preread:api/queue) and [the queue again](preread:api/queue \"title\")."),
    { id: "gif", kind: "visual", visual: { id: "gif", title: "Send", path: "/tmp/send.gif" } },
    markdown("detail", "### Detail\n\n[Menu](<preread:ui/menu>)"),
    markdown("receive", "## Receive"),
    { id: "excerpt", kind: "code", language: "ts", code: "x", approval: false, reference: { review: "ui", group: "inbox" } },
  ];
  const { sections, owners } = briefStructure(brief(blocks));
  assert.deepEqual(sections.map((section) => [section.heading?.text, section.start, section.end, section.groups]), [
    [undefined, "status", "status", []],
    ["Send", "send", "detail", [{ review: "api", group: "queue" }, { review: "ui", group: "menu" }]],
    ["Receive", "receive", "excerpt", [{ review: "ui", group: "inbox" }]],
  ]);
  assert.deepEqual(blockTargets(blocks[0]), [{ review: "api" }]);
  assert.deepEqual([...owners], [["send", "send:0"], ["gif", "send:0"], ["detail", "detail:0"], ["receive", "receive:0"], ["excerpt", "receive:0"]]);
});

test("a block with several top-level headings gives each its own section and code", () => {
  const blocks: BriefBlock[] = [
    markdown("a", [
      "Intro [x](preread:api/intro)", "## Migrations", "See [schema](preread:db/schema).", "### Down", "[down](preread:db/down)",
      "## API", "[routes](preread:api/routes)",
    ].join("\n\n")),
    markdown("b", "More on the API: [more](preread:api/more)"),
  ];
  const { sections, owners, headings } = briefStructure(brief(blocks));
  assert.deepEqual(sections.map((section) => [section.heading?.key, section.start, section.end, section.groups.map((group) => group.group)]), [
    [undefined, "a", "a", ["intro"]],
    ["a:0", "a", "a", ["schema", "down"]],
    ["a:2", "a", "b", ["routes", "more"]],
  ]);
  assert.deepEqual([...owners], [["b", "a:2"]]);
  assert.deepEqual(headings.get("a")?.map((heading) => heading.key), ["a:0", "a:1", "a:2"]);
});
