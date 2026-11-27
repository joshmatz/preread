import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import type { DiffFile } from "diff2html/lib/types";
import { refineWordHighlights } from "./diff-highlights";
import { orderUnifiedChanges } from "./diff-order";
import { highlightDiff, type DiffSyntax, type Run } from "./highlight";

export function drawDiff(element: HTMLElement, displayed: string | DiffFile[], { split, matching, ignoreWhitespace, decorate, syntax }: {
  split: boolean; matching: "lines" | "none"; ignoreWhitespace: boolean; decorate?: (run: Run, extension: string) => void;
  syntax?: DiffSyntax | Promise<DiffSyntax | undefined>;
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
  if (syntax instanceof Promise) {
    const rendered = element.firstElementChild;
    void syntax.then((source) => {
      if (rendered === element.firstElementChild) highlightDiff(element, decorate, source);
    });
  } else highlightDiff(element, decorate, syntax);
}

export const insertedRows = ".line-comment-row, .line-comment-spacer, .removed-fold";
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

// The first changed line not scrolled above `top`, else the last one above it. Since viewed, old line
// numbers count the viewed text rather than the base, so only added lines count.
export function changeFrom(element: HTMLElement, split: boolean, top: number, newOnly = false) {
  const gutter = split ? "td.d2h-code-side-linenumber" : "td.d2h-code-linenumber";
  let below: { cell: HTMLElement; top: number } | undefined;
  let above: typeof below;
  for (const cell of element.querySelectorAll<HTMLElement>(`${gutter}:is(.d2h-ins${newOnly ? "" : ", .d2h-del"})`)) {
    const box = cell.getBoundingClientRect();
    if (!box.height) continue;
    if (box.bottom > top) {
      if (!below || box.top < below.top) below = { cell, top: box.top };
    } else if (!above || box.top > above.top) above = { cell, top: box.top };
  }
  const cell = (below ?? above)?.cell;
  if (!cell) return;
  const side = cell.classList.contains("d2h-del") ? "old" as const : "new" as const;
  const line = lineNumber(split ? cell : cell.querySelector(side === "old" ? ".line-num1" : ".line-num2"));
  return line ? { side, line } : undefined;
}

type RowKind = "removed" | "added" | "context" | "empty";
// Runs of rows that show only removed lines, as [start, end) indexes. In split view, `beside`
// holds the new side's rows, and a removed line paired with an added one stays shown.
export function removedRuns(rows: RowKind[], beside?: RowKind[]) {
  const runs: { start: number; end: number }[] = [];
  rows.forEach((kind, index) => {
    if (kind !== "removed" || (beside && beside[index] !== "empty")) return;
    const last = runs.at(-1);
    if (last?.end === index) last.end += 1;
    else runs.push({ start: index, end: index + 1 });
  });
  return runs;
}

const rowKind = (row: HTMLTableRowElement): RowKind =>
  row.querySelector("td.d2h-emptyplaceholder") ? "empty"
    : row.querySelector("td.d2h-del") ? "removed"
    : row.querySelector("td.d2h-ins") ? "added" : "context";

type Fold = { rows: HTMLTableRowElement[]; markers: HTMLTableRowElement[]; button: HTMLButtonElement };
const folds = new WeakMap<Element, Fold>();
export const foldOver = (row: Element | null | undefined) =>
  row instanceof HTMLTableRowElement && row.hidden ? folds.get(row) : undefined;
export function setFolded({ rows, button }: Fold, folded: boolean) {
  for (const row of rows) row.hidden = folded;
  button.setAttribute("aria-expanded", String(!folded));
}

const chevron = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Folds each run of removed lines into one row whose button shows them, and returns what unfolds them all.
export function foldRemoved(element: HTMLElement, split: boolean) {
  const { sides } = diffRows(element, split);
  const made: Fold[] = [];
  for (let pair = 0; pair < sides.length; pair += split ? 2 : 1) {
    const rows = sides[pair];
    const beside = split ? sides[pair + 1] : undefined;
    for (const { start, end } of removedRuns(rows.map(rowKind), beside?.map(rowKind))) {
      const tables = beside ? [rows, beside] : [rows];
      const markers = tables.map((side, index) => {
        const marker = document.createElement("tr");
        marker.className = index ? "removed-fold beside" : "removed-fold";
        const gutter = document.createElement("td");
        gutter.className = split ? "d2h-code-side-linenumber" : "d2h-code-linenumber";
        marker.append(gutter, document.createElement("td"));
        side[start].before(marker);
        return marker;
      });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "removed-fold-button";
      button.innerHTML = chevron;
      button.append(`${end - start} removed ${end - start === 1 ? "line" : "lines"}`);
      markers[0].cells[1].append(button);
      const fold = { rows: tables.flatMap((side) => side.slice(start, end)), markers, button };
      button.addEventListener("click", () => setFolded(fold, !fold.rows[0].hidden));
      for (const row of fold.rows) folds.set(row, fold);
      setFolded(fold, true);
      made.push(fold);
    }
  }
  return () => {
    for (const fold of made) {
      setFolded(fold, false);
      for (const row of fold.rows) folds.delete(row);
      for (const marker of fold.markers) marker.remove();
    }
  };
}
