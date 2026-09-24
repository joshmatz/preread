interface Row {
  text: string;
  old: number;
  next: number;
}
interface Hunk {
  rows: Row[];
  heading: string;
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
}
type Interval = { start: number; end: number; heading: string };
export const CONTEXT_LINES = 5;
export interface ContextModel {
  header: string;
  rows: Row[];
  intervals: Interval[];
}
export interface ContextGap {
  above: number;
  below: number;
  all: boolean;
  otherChanges?: boolean;
}
function parse(patch: string) {
  let header = "";
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  let old = 0,
    next = 0;
  for (const text of patch.split(/(?<=\n)/)) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/.exec(text);
    if (match) {
      current = {
        rows: [],
        heading: match[5],
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? 1),
      };
      old = current.oldStart + (current.oldCount === 0 ? 1 : 0);
      next = current.newStart + (current.newCount === 0 ? 1 : 0);
      hunks.push(current);
    } else if (current) {
      if (/^[ +\\-]/.test(text)) {
        current.rows.push({ text, old, next });
        if (text.startsWith(" ") || text.startsWith("-")) old += 1;
        if (text.startsWith(" ") || text.startsWith("+")) next += 1;
      }
    } else header += text;
  }
  return { header, hunks };
}
const key = (row: Row) => `${row.old}/${row.next}/${row.text}`;
export function createContextModel(original: string, expanded: string): ContextModel {
  const full = parse(expanded);
  if (full.hunks.length !== 1) throw new Error("Full file context is unavailable for this diff.");
  const rows = full.hunks[0].rows;
  const positions = new Map(rows.map((row, index) => [key(row), index]));
  const intervals = parse(original).hunks.map((hunk) => {
    const start = positions.get(key(hunk.rows[0]));
    if (
      start === undefined ||
      hunk.rows.some(
        (row, offset) => key(rows[start + offset] ?? { old: -1, next: -1, text: "" }) !== key(row),
      )
    )
      throw new Error(
        "This file changed since the diff loaded. Refresh the review to see its current context.",
      );
    return { start, end: start + hunk.rows.length, heading: hunk.heading };
  });
  return { header: full.header, rows, intervals };
}
const unchanged = (model: ContextModel, index: number): boolean =>
  model.rows[index].text.startsWith(" ") ||
  (model.rows[index].text.startsWith("\\") &&
    index > 0 &&
    model.rows[index - 1].text.startsWith(" "));
export function contextGaps(model: ContextModel): ContextGap[] {
  return Array.from({ length: model.intervals.length + 1 }, (_, index) => {
    const start = index ? model.intervals[index - 1].end : 0;
    const end = model.intervals[index]?.start ?? model.rows.length;
    let above = 0,
      below = 0;
    if (index < model.intervals.length)
      while (end - above > start && unchanged(model, end - above - 1)) above += 1;
    if (index > 0) while (start + below < end && unchanged(model, start + below)) below += 1;
    const all = Math.max(above, below) === end - start;
    return { above, below, all, otherChanges: !all && end > start };
  });
}
// Git ends a hunk with CONTEXT_LINES unchanged lines unless the file ends first.
function endsFile({ rows }: Hunk) {
  let context = 0;
  while (context < rows.length && rows[rows.length - 1 - context].text.startsWith(" "))
    context += 1;
  return context < CONTEXT_LINES || rows.some((row) => row.text.startsWith("\\"));
}
export function initialGaps(patch: string): ContextGap[] {
  const { hunks } = parse(patch);
  return Array.from({ length: hunks.length + 1 }, (_, index) => {
    if (index === hunks.length) {
      const last = hunks.at(-1);
      return { above: 0, below: last && !endsFile(last) ? 20 : 0, all: false };
    }
    const hunk = hunks[index];
    const previous = hunks[index - 1];
    const gap = Math.max(
      0,
      hunk.newStart - (previous ? previous.newStart + previous.newCount : 1),
      hunk.oldStart - (previous ? previous.oldStart + previous.oldCount : 1),
    );
    return { above: gap, below: index ? gap : 0, all: false };
  });
}
export function expandContext(
  model: ContextModel,
  gap: number,
  direction: "above" | "below" | "all",
  amount = 20,
): ContextModel {
  const available = contextGaps(model)[gap];
  const intervals = model.intervals.map((interval) => ({ ...interval }));
  if (!available || (direction === "all" && !available.all)) return model;
  if (direction === "above" || (direction === "all" && gap < intervals.length)) {
    if (intervals[gap])
      intervals[gap].start -=
        direction === "all" ? available.above : Math.min(amount, available.above);
  } else if (intervals[gap - 1])
    intervals[gap - 1].end +=
      direction === "all" ? available.below : Math.min(amount, available.below);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && previous.end >= interval.start)
      previous.end = Math.max(previous.end, interval.end);
    else merged.push(interval);
  }
  return { ...model, intervals: merged };
}
export function contextPatch(model: ContextModel) {
  return (
    model.header +
    model.intervals
      .map(({ start, end, heading }) => {
        const rows = model.rows.slice(start, end);
        const oldCount = rows.filter((row) => /^[ -]/.test(row.text)).length;
        const newCount = rows.filter((row) => /^[ +]/.test(row.text)).length;
        const first = rows[0];
        return (
          `@@ -${first.old - (oldCount ? 0 : 1)},${oldCount} +${first.next - (newCount ? 0 : 1)},${newCount} @@${heading}\n` +
          rows.map((row) => row.text).join("")
        );
      })
      .join("")
  );
}
