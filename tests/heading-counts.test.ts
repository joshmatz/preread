import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { headingCounts } from "../src/BriefContents.tsx";
import { briefStructure } from "../src/brief-outline.ts";
import { Markdown } from "../src/Markdown.tsx";
import type { BriefBlock, BriefFeedback, BriefSnapshot } from "../src/brief-types.ts";

type MarkdownBlock = Extract<BriefBlock, { kind: "markdown" }>;
const summary: MarkdownBlock = { id: "summary", kind: "markdown", markdown: "## Overview\n\nThe parts are menus and popovers." };
const parts: MarkdownBlock = { id: "parts", kind: "markdown",
  markdown: "Before the parts.\n\n- Menus\n- [Popovers](preread:dropdown/popovers)\n\n## Menus\n\nMenus open 4px away.\n\n## Popovers\n\nPopovers lose their arrow." };
// A selection keeps its block's text as the overview rendered it, with an arrow after each link into the review.
const renderedText = (block: MarkdownBlock) =>
  renderToStaticMarkup(createElement(Markdown, { children: block.markdown, onReference: () => {} })).replace(/<[^>]*>/g, "");
const selecting = (block: MarkdownBlock, words: string): BriefFeedback => {
  const text = renderedText(block);
  const start = text.indexOf(words);
  assert.ok(start >= 0, words);
  return { id: `on-${start}`, createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z", kind: "comment", body: "Why?",
    attachments: [], anchor: { kind: "selection", segments: [{ block: block.id, revision: "r", part: "markdown", text, start, end: start + words.length }] } };
};
const brief = { blocks: [summary, parts] };
const snapshot = (feedback: BriefFeedback[]): BriefSnapshot =>
  ({ brief, version: "v", fingerprints: { summary: "r", parts: "r" }, feedback, threads: {} });
const comments = (counts: ReturnType<typeof headingCounts>) => Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.comments]));

test("without the rendered overview, a selection counts under the heading line before it, past list items that read the same", () => {
  const feedback = [selecting(parts, "Before the parts."), selecting(parts, "Menus"), selecting(parts, "Popovers"),
    selecting(parts, "Menus open"), selecting(parts, "Popovers lose")];
  assert.deepEqual(comments(headingCounts(snapshot(feedback), briefStructure(brief))), { "summary:0": 3, "parts:0": 1, "parts:1": 1 });
});

test("the overview's rendered heading offsets decide when it passes them", () => {
  const feedback = [selecting(parts, "Before the parts.")];
  assert.deepEqual(comments(headingCounts(snapshot(feedback), briefStructure(brief), { "parts:0": 0, "parts:1": 0 })), { "parts:1": 1 });
});
