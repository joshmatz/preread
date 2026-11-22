import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { BriefSelection, BriefSnapshot } from "./brief-types";
import { feedbackCurrent } from "./brief-feedback";
import { threadState } from "./threads";
import { captureBriefSelection, rangeForSegment } from "./brief-selection";

export function useBriefAnnotations(root: RefObject<HTMLElement | null>, snapshot: BriefSnapshot | null, active: boolean, modalOpen: boolean) {
  const [selection, setSelection] = useState<{ anchor: BriefSelection; x: number; y: number } | null>(null);
  const ranges = useRef<Array<{ id: string; range: Range }>>([]);
  const [layout, setLayout] = useState(0);
  useEffect(() => {
    const remeasure = (event: Event) => { if (root.current?.contains(event.target as Node)) setLayout((count) => count + 1); };
    document.addEventListener("preread-text-change", remeasure);
    return () => document.removeEventListener("preread-text-change", remeasure);
  }, [root]);
  useLayoutEffect(() => {
    ranges.current = [];
    if (active && root.current && snapshot) {
      for (const entry of snapshot.feedback) {
        if (entry.kind !== "comment" || entry.anchor.kind !== "selection" || !feedbackCurrent(entry, snapshot)
          || threadState(entry, snapshot.threads[entry.id]).turn === "resolved") continue;
        for (const segment of entry.anchor.segments) {
          const range = rangeForSegment(root.current, segment);
          if (range) ranges.current.push({ id: entry.id, range });
        }
      }
    }
    if (typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights)
      CSS.highlights.set("preread-brief-notes", new Highlight(...ranges.current.map((entry) => entry.range)));
    return () => { if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete("preread-brief-notes"); };
  }, [snapshot, active, layout]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active || modalOpen || !root.current || !snapshot) { setSelection(null); return; }
        const anchor = captureBriefSelection(root.current, snapshot);
        const current = window.getSelection();
        if (!anchor || !current?.rangeCount) { setSelection(null); return; }
        const rectangle = current.getRangeAt(0).getBoundingClientRect();
        setSelection({ anchor, x: Math.max(8, Math.min(window.innerWidth - 240, rectangle.left)),
          y: Math.max(8, Math.min(window.innerHeight - 48, rectangle.bottom + 8)) });
      });
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerup", update);
    const hide = () => setSelection(null);
    window.addEventListener("scroll", hide, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("selectionchange", update); document.removeEventListener("pointerup", update); window.removeEventListener("scroll", hide, true); };
  }, [snapshot, active, modalOpen]);
  const notesAt = (x: number, y: number) => [...new Set(ranges.current.filter(({ range }) =>
    [...range.getClientRects()].some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)).map((entry) => entry.id))];
  return { selection, clearSelection: () => setSelection(null), notesAt };
}
