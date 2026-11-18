import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import type { DiffFile } from "diff2html/lib/types";
import { refineWordHighlights } from "./diff-highlights";
import { orderUnifiedChanges } from "./diff-order";
import { highlightDiff } from "./highlight";

export function drawDiff(element: HTMLElement, displayed: string | DiffFile[], { split, matching, ignoreWhitespace, decorate }: {
  split: boolean; matching: "lines" | "none"; ignoreWhitespace: boolean; decorate?: (line: Element) => void;
}) {
  new Diff2HtmlUI(element, displayed, {
    drawFileList: false,
    outputFormat: split ? "side-by-side" : "line-by-line",
    matching,
    highlight: false,
    synchronisedScroll: true,
    renderNothingWhenEmpty: false,
    fileContentToggle: false,
    stickyFileHeaders: false,
  }).draw();
  refineWordHighlights(element);
  orderUnifiedChanges(element);
  // Merge before syntax highlighting introduces its own nested spans.
  for (const change of element.querySelectorAll(
    ".d2h-code-line-ctn > ins, .d2h-code-line-ctn > del",
  )) {
    while (change.nextSibling) {
      const gap = change.nextSibling;
      const next =
        gap.nodeType === Node.TEXT_NODE && /^\s*$/.test(gap.textContent ?? "")
          ? gap.nextSibling
          : gap;
      if (!(next instanceof Element) || next.tagName !== change.tagName) break;
      if (gap !== next) change.append(gap);
      change.append(...next.childNodes);
      next.remove();
    }
  }
  if (ignoreWhitespace) {
    for (const change of element.querySelectorAll(
      ".d2h-code-line-ctn > ins, .d2h-code-line-ctn > del",
    )) {
      if (!change.textContent?.trim()) change.replaceWith(...change.childNodes);
    }
  }
  highlightDiff(element);
  if (decorate) element.querySelectorAll(".d2h-code-line-ctn").forEach(decorate);
}

export const insertedRows = ".line-comment-row, .line-comment-spacer";
const lineNumber = (cell: Element | null | undefined) => {
  const value = Number(cell?.textContent?.trim() || NaN);
  return value > 0 ? value : 0;
};
export function diffRows(element: HTMLElement, split: boolean) {
  const sides = (split ? [...element.querySelectorAll(".d2h-file-side-diff")] : [element]).map((table) =>
    [...table.querySelectorAll<HTMLTableRowElement>(".d2h-diff-tbody > tr")].filter((row) => !row.matches(insertedRows)));
  const keyAt = (side: number, index: number): string => {
    const row = sides[side]?.[index];
    if (!row) return "";
    if (!split) {
      const next = lineNumber(row.querySelector(".line-num2"));
      const old = lineNumber(row.querySelector(".line-num1"));
      return next ? `new:${next}` : old ? `old:${old}` : "";
    }
    const cell = row.querySelector("td.d2h-code-side-linenumber");
    if (!cell || cell.matches(".d2h-emptyplaceholder, .d2h-info") || !lineNumber(cell)) return "";
    // Tables pair up old, new: a type change draws two files, so four tables.
    if (side % 2) return `new:${lineNumber(cell)}`;
    return cell.classList.contains("d2h-del") ? `old:${lineNumber(cell)}` : keyAt(side + 1, index);
  };
  const byKey = new Map<string, { row: HTMLTableRowElement; side: number; index: number }>();
  sides.forEach((rows, side) => rows.forEach((row, index) => {
    const key = keyAt(side, index);
    // Split view shows a context line in both tables; its comments go under the new side.
    if (key && !(split && side % 2 === 0 && key.startsWith("new:"))) byKey.set(key, { row, side, index });
  }));
  const keyOf = (cell: Element) => {
    const row = cell.closest("tr");
    for (const [side, rows] of sides.entries()) {
      const index = rows.indexOf(row!);
      if (index >= 0) return keyAt(side, index);
    }
    return "";
  };
  return { sides, byKey, keyOf };
}

// Unlike diffRows' keys, this also finds a context row by its old line.
export function rowAt(element: HTMLElement, split: boolean, side: "old" | "new", line: number) {
  const cells = split
    ? [...element.querySelectorAll<HTMLElement>(".d2h-file-side-diff")]
      .filter((_, index) => index % 2 === (side === "old" ? 0 : 1))
      .flatMap((table) => [...table.querySelectorAll<HTMLElement>(".d2h-code-side-linenumber")])
    : [...element.querySelectorAll<HTMLElement>(side === "old" ? ".line-num1" : ".line-num2")];
  return cells.find((cell) => Number(cell.textContent) === line)?.closest("tr") ?? undefined;
}
