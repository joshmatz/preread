import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { BriefBlock, FeatureBrief } from "./brief-types.ts";

export type BriefTarget = { review: string; group?: string };
export type GroupTarget = { review: string; group: string };
// `line` is the heading as the overview renders it, and `repeat` counts the earlier lines in its block that read the same.
export type OutlineHeading = { key: string; block: string; index: number; level: 2 | 3; text: string; line: string; repeat: number };
// A section starts at a top-level heading and ends where the next one starts; content before the first forms one too.
// Its code panel renders after `end`, the last block it reaches.
export type BriefSection = { heading?: OutlineHeading; start: string; end: string; groups: GroupTarget[] };
export type BriefStructure = {
  outline: OutlineHeading[];
  sections: BriefSection[];
  headings: Map<string, OutlineHeading[]>;
  // The heading a block's start belongs to: the one it opens with, or the last one before it.
  owners: Map<string, string>;
};

export const referencePattern = /^preread:([a-z0-9][a-z0-9-]{0,79})(?:\/([a-z0-9][a-z0-9-]{0,79}))?$/;

// The same parser and plugins as the rendered Markdown, so heading positions match the page's headings.
const processor = unified().use(remarkParse).use(remarkGfm);
type Node = ReturnType<typeof processor.parse> | ReturnType<typeof processor.parse>["children"][number];
type Parsed = {
  headings: Array<{ index: number; level: 2 | 3; text: string; line: string; repeat: number }>;
  opening?: number;
  // `heading` is the index of the last top-level heading at or before the link.
  targets: Array<BriefTarget & { heading?: number }>;
};
const parsed = new Map<string, Parsed>();

const childrenOf = (node: Node) => "children" in node ? node.children as Node[] : [];
const textOf = (node: Node): string => node.type === "html" ? "" : "value" in node ? node.value : childrenOf(node).map(textOf).join("");
function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const child of childrenOf(node)) walk(child, visit);
}

export function parseMarkdown(markdown: string): Parsed {
  const cached = parsed.get(markdown);
  if (cached) return cached;
  const tree = processor.parse(markdown);
  const definitions = new Map<string, string>();
  walk(tree, (node) => { if (node.type === "definition") definitions.set(node.identifier, node.url); });
  const headings: Parsed["headings"] = [];
  const targets: Parsed["targets"] = [];
  const urlOf = (node: Node) => node.type === "link" ? node.url : node.type === "linkReference" ? definitions.get(node.identifier) : undefined;
  // The overview ends each link into the review with an arrow.
  const shown = (node: Node): string => node.type === "html" ? "" : "value" in node ? node.value
    : childrenOf(node).map(shown).join("") + (referencePattern.test(urlOf(node) ?? "") ? " ↗" : "");
  const linesOf = (node: Node) => node.type === "code" ? node.value.split("\n")
    : node.type === "paragraph" || node.type === "heading" || node.type === "tableCell" ? shown(node).split("\n") : [];
  const lines = new Map<string, number>();
  let index = -1;
  let opening: number | undefined;
  tree.children.forEach((top, position) => {
    if (top.type === "heading" && top.depth <= 3) {
      index += 1;
      // An empty heading still renders, so it keeps its place in the count without a contents entry.
      const text = textOf(top).replace(/\s+/g, " ").trim();
      const line = shown(top);
      if (text) headings.push({ index, level: top.depth <= 2 ? 2 : 3, text, line, repeat: lines.get(line) ?? 0 });
      if (position === 0 && text) opening = index;
    }
    walk(top, (node) => {
      for (const line of linesOf(node)) lines.set(line, (lines.get(line) ?? 0) + 1);
      const match = urlOf(node)?.match(referencePattern);
      if (match) targets.push({ ...(match[2] ? { review: match[1], group: match[2] } : { review: match[1] }), ...(index >= 0 ? { heading: index } : {}) });
    });
  });
  const result: Parsed = { headings, targets, ...(opening === undefined ? {} : { opening }) };
  if (parsed.size > 500) parsed.clear();
  parsed.set(markdown, result);
  return result;
}

export function blockHeadings(block: BriefBlock): OutlineHeading[] {
  if (block.kind !== "markdown") return [];
  return parseMarkdown(block.markdown).headings.map((entry) => ({ key: `${block.id}:${entry.index}`, block: block.id, ...entry }));
}

export const briefOutline = (brief: FeatureBrief) => brief.blocks.flatMap(blockHeadings);

export function blockTargets(block: BriefBlock): Parsed["targets"] {
  if (block.kind === "code") return block.reference ? [{ review: block.reference.review, group: block.reference.group }] : [];
  return block.kind === "markdown" ? parseMarkdown(block.markdown).targets : [];
}

export function briefStructure(brief: FeatureBrief): BriefStructure {
  const outline: OutlineHeading[] = [];
  const sections: BriefSection[] = [];
  const headings = new Map<string, OutlineHeading[]>();
  const owners = new Map<string, string>();
  let current: BriefSection | undefined;
  let owner = "";
  const add = (section: BriefSection, target: GroupTarget) => {
    if (!section.groups.some((entry) => entry.review === target.review && entry.group === target.group)) section.groups.push(target);
  };
  for (const block of brief.blocks) {
    const own = blockHeadings(block);
    const opening = block.kind === "markdown" ? parseMarkdown(block.markdown).opening : undefined;
    outline.push(...own);
    headings.set(block.id, own);
    const first = own.find((heading) => heading.index === opening);
    if (first ?? owner) owners.set(block.id, first?.key ?? owner);
    if (own.length) owner = own[own.length - 1].key;
    const tops = own.filter((heading) => heading.level === 2);
    const opensSection = tops[0] !== undefined && tops[0].index === opening;
    if (!opensSection) {
      current ??= { start: block.id, end: block.id, groups: [] };
      if (!sections.includes(current)) sections.push(current);
      current.end = block.id;
    }
    const carried = opensSection ? undefined : current;
    const started = tops.map((heading) => {
      current = { heading, start: block.id, end: block.id, groups: [] };
      sections.push(current);
      return current;
    });
    for (const target of blockTargets(block)) {
      const { group, heading } = target;
      if (!group) continue;
      let index = -1;
      if (heading !== undefined) tops.forEach((entry, position) => { if (entry.index <= heading) index = position; });
      const section = index >= 0 ? started[index] : carried ?? started[0];
      if (section) add(section, { review: target.review, group });
    }
  }
  return { outline, sections, headings, owners };
}
