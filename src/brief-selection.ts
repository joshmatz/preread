import type { BriefSegment, BriefSelection, BriefSnapshot } from "./brief-types.ts";

export function textOffset(element: HTMLElement, node: Node, position: number) {
  const before = document.createRange(); before.selectNodeContents(element); before.setEnd(node, position);
  return before.toString().length;
}
export function captureBriefSelection(root: HTMLElement, snapshot: BriefSnapshot): BriefSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const segments: BriefSegment[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("[data-brief-text]")) {
    if (!range.intersectsNode(element)) continue;
    const block = snapshot.brief.blocks.find((block) => block.id === element.dataset.briefText);
    if (!block) continue;
    const text = element.textContent ?? "";
    const start = element.contains(range.startContainer) ? textOffset(element, range.startContainer, range.startOffset) : 0;
    const end = element.contains(range.endContainer) ? textOffset(element, range.endContainer, range.endOffset) : text.length;
    if (end <= start || !text.slice(start, end).trim()) continue;
    segments.push({ block: block.id, revision: snapshot.fingerprints[block.id],
      part: block.kind === "visual" ? "caption" : block.kind, text, start, end });
  }
  if (!segments.length) return null;
  return { kind: "selection", segments };
}
export function rangeForSegment(root: HTMLElement, segment: BriefSegment): Range | null {
  const element = [...root.querySelectorAll<HTMLElement>("[data-brief-text]")]
    .find((element) => element.dataset.briefText === segment.block);
  if (!element || element.textContent !== segment.text) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!started && segment.start <= offset + length) { range.setStart(node, segment.start - offset); started = true; }
    if (started && segment.end <= offset + length) { range.setEnd(node, segment.end - offset); return range; }
    offset += length;
  }
  return null;
}
