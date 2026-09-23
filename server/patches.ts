import type { LineRange } from "../src/review-types.ts";

export interface PatchHunk {
  text: string;
  oldLines: number[];
  newLines: number[];
}
export function parsePatch(patch: string) {
  const lines = patch.split(/(?<=\n)/);
  let header = "";
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      current = { text: line, oldLines: [], newLines: [] };
      hunks.push(current);
    } else if (current) {
      current.text += line;
      if (line.startsWith("-")) {
        current.oldLines.push(oldLine);
        oldLine += 1;
      } else if (line.startsWith("+")) {
        current.newLines.push(newLine);
        newLine += 1;
      } else if (line.startsWith(" ")) {
        oldLine += 1;
        newLine += 1;
      }
    } else header += line;
  }
  return { header, hunks };
}
export const matchesRanges = (hunk: PatchHunk, ranges: LineRange[]) =>
  ranges.some((range) =>
    (range.side === "old" ? hunk.oldLines : hunk.newLines).some(
      (line) => line >= range.start && line <= range.end,
    ),
  );
export const patchFor = (header: string, hunks: PatchHunk[]) =>
  header + hunks.map((hunk) => hunk.text).join("");
// Whole-file blob IDs and shifted line numbers do not change the content of a selected block.
export const reviewContent = (patch: string) =>
  patch.replace(/^index .*\n/gm, "").replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, "@@");
