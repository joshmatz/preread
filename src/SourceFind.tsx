import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { diffRows } from "./draw-diff";

// Where `query` starts in `text`, ignoring case, one match after another as a browser's find does.
export function occurrences(text: string, query: string) {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return [...text.matchAll(pattern)].map(match => match.index);
}

type Point = [node: number, offset: number];
// Each match as start and end points over a line's text nodes, given their lengths. Matches come in order.
export function spans(lengths: number[], starts: number[], length: number) {
  let node = 0;
  let base = 0;
  const seek = (offset: number, end: boolean): Point => {
    while (node < lengths.length - 1 && (end ? offset > base + lengths[node] : offset >= base + lengths[node])) base += lengths[node++];
    return [node, offset - base];
  };
  return starts.map(start => ({ start: seek(start, false), end: seek(start + length, true) }));
}

// The lines in reading order: a whole file is one block, and a split diff reads across each row.
function lines(pane: HTMLElement, split: boolean) {
  const code = pane.querySelector(".definition-code > code");
  if (code) return [code];
  const sheet = pane.querySelector<HTMLElement>(".source-diff");
  if (!sheet) return [];
  const { sides } = diffRows(sheet, split);
  const found: Element[] = [];
  // A type change draws two files, so a split diff has a pair of tables for each.
  for (let pair = 0; pair < sides.length; pair += split ? 2 : 1) {
    const tables = sides.slice(pair, pair + (split ? 2 : 1));
    for (let row = 0; row < Math.max(...tables.map(rows => rows.length)); row++)
      for (const rows of tables) {
        const line = rows[row]?.querySelector(".d2h-code-line-ctn");
        if (line) found.push(line);
      }
  }
  return found;
}

function search(pane: HTMLElement, split: boolean, query: string) {
  const ranges: Range[] = [];
  for (const line of lines(pane, split)) {
    const starts = occurrences(line.textContent!, query);
    if (!starts.length) continue;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const { start, end } of spans(nodes.map(node => node.length), starts, query.length)) {
      const range = document.createRange();
      range.setStart(nodes[start[0]], start[1]);
      range.setEnd(nodes[end[0]], end[1]);
      ranges.push(range);
    }
  }
  return ranges;
}

type Anchor = { top: number; bottom: number; left: number };
// The first match at or after `anchor` in reading order, or the count when every match is before it.
function firstFrom(ranges: Range[], anchor: Anchor) {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const box = ranges[middle].getBoundingClientRect();
    if (box.bottom <= anchor.top + 1 || (box.top < anchor.bottom - 1 && box.left < anchor.left)) low = middle + 1;
    else high = middle;
  }
  return low;
}

const highlights = typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights;
function paint(ranges: Range[], current: number) {
  if (!highlights) return;
  const others = new Highlight();
  ranges.forEach((range, i) => { if (i !== current) others.add(range); });
  highlights.set("preread-source-find", others);
  if (ranges[current]) highlights.set("preread-source-find-current", new Highlight(ranges[current]));
  else highlights.delete("preread-source-find-current");
}

// Line numbers stick to the left edge as code scrolls sideways under them.
function reveal(pane: HTMLElement, range: Range, bar: HTMLElement) {
  const box = range.getBoundingClientRect();
  const view = pane.getBoundingClientRect();
  const cover = bar.getBoundingClientRect();
  const covered = box.bottom > cover.top && box.top < cover.bottom && box.right > cover.left && box.left < cover.right;
  if (covered || box.top < view.top || box.bottom > view.top + pane.clientHeight)
    pane.scrollTop += box.top - view.top - (pane.clientHeight - box.height) / 2;
  let scroller = range.startContainer.parentElement!;
  while (scroller !== pane && !(scroller.scrollWidth > scroller.clientWidth && /auto|scroll/.test(getComputedStyle(scroller).overflowX)))
    scroller = scroller.parentElement!;
  const area = scroller.getBoundingClientRect();
  const gutter = pane.querySelector(".source-gutter") ?? range.startContainer.parentElement!.closest("tr")?.querySelector(".d2h-code-linenumber");
  const left = Math.max(area.left, gutter?.getBoundingClientRect().right ?? area.left);
  const right = area.left + scroller.clientWidth;
  if (box.left < left || box.right > right) scroller.scrollLeft += box.left - left - (right - left) / 3;
}

export type Step = (by: 1 | -1) => void;

export function SourceFind({ query, request, drawn, split, scroller, stepper, onQuery, onClose }: {
  query: string; request: number; drawn: object; split: boolean; scroller: React.RefObject<HTMLDivElement | null>;
  stepper: React.RefObject<Step | undefined>; onQuery: (query: string) => void; onClose: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const found = useRef({ ranges: [] as Range[], current: -1, drawn });
  const [shown, setShown] = useState<{ current: number; count: number } | null>(null);

  function show(current: number, scroll: boolean) {
    const { ranges } = found.current;
    found.current.current = current;
    paint(ranges, current);
    if (scroll && ranges[current]) reveal(scroller.current!, ranges[current], bar.current!);
    setShown({ current, count: ranges.length });
  }
  const viewTop = () => {
    const top = scroller.current!.getBoundingClientRect().top;
    return { top, bottom: top, left: -Infinity };
  };
  function step(by: 1 | -1) {
    const { ranges, current } = found.current;
    if (!ranges.length) return;
    const from = current >= 0 ? current + by : firstFrom(ranges, viewTop()) - (by < 0 ? 1 : 0);
    show((from + ranges.length) % ranges.length, true);
  }
  stepper.current = step;

  useLayoutEffect(() => {
    field.current!.focus();
    field.current!.select();
  }, [request]);

  useLayoutEffect(() => {
    const pane = scroller.current;
    const previous = found.current.ranges[found.current.current];
    // A redrawn file keeps the query, but which match is next waits for the reader, as after a browser's page loads.
    const redrawn = found.current.drawn !== drawn;
    found.current = { ranges: pane && query ? search(pane, split, query) : [], current: -1, drawn };
    const { ranges } = found.current;
    if (!pane) setShown(null);
    else if (redrawn || !ranges.length) show(-1, false);
    else {
      // Typing on from a match keeps it when it still matches.
      const anchor = previous?.startContainer.isConnected ? previous.getBoundingClientRect() : viewTop();
      show(firstFrom(ranges, anchor) % ranges.length, true);
    }
  }, [query, drawn, split]);

  useEffect(() => () => {
    if (highlights) for (const name of ["preread-source-find", "preread-source-find-current"]) highlights.delete(name);
  }, []);

  const status = !shown || !query ? "" : !shown.count ? "No matches"
    : shown.current >= 0 ? `${shown.current + 1} of ${shown.count}` : `${shown.count} ${shown.count === 1 ? "match" : "matches"}`;
  return <div ref={bar} className="source-find" role="search" aria-label="Find in file">
    <input ref={field} aria-label="Find in file" placeholder="Find in file" value={query} spellCheck={false}
      onChange={event => onQuery(event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") step(event.shiftKey ? -1 : 1);
        else if (event.key === "Escape") {
          // Without this the dialog would take the key as a request to close.
          event.preventDefault();
          onClose();
        }
      }} />
    <span className="source-find-count" role="status">{status}</span>
    <button type="button" title="Previous match (⇧Enter)" aria-label="Previous match" disabled={!shown?.count} onClick={() => step(-1)}><ArrowUp size={15} /></button>
    <button type="button" title="Next match (Enter)" aria-label="Next match" disabled={!shown?.count} onClick={() => step(1)}><ArrowDown size={15} /></button>
    <button type="button" title="Close (Esc)" aria-label="Close find" onClick={onClose}><X size={15} /></button>
  </div>;
}
