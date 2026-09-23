import { diffArrays } from "diff";
import { parse } from "diff2html";
import { LineType, type DiffLine } from "diff2html/lib/types";

const withoutSpaces = (value: string) => value.replace(/[\t\r\f\v ]/g, "");

// Only the renderer receives these lines. Group membership, hashes and review
// receipts continue to use the original patch, including its whitespace.
export function whitespaceDiff(patch: string) {
  const files = parse(patch);
  const rawBlocks = patch.split(/^@@ .*@@.*\n/gm).slice(1);
  let blockIndex = 0;
  for (const file of files) {
    for (const block of file.blocks) {
      const raw = rawBlocks[blockIndex] ?? "";
      blockIndex += 1;
      const oldLines = block.lines.filter((line) => line.type !== LineType.INSERT);
      const newLines = block.lines.filter((line) => line.type !== LineType.DELETE);
      // Newline markers are absent from diff2html's line model; retain that
      // distinction so ignoring spaces cannot hide an added/removed final newline.
      const noNewline = new Set<string>();
      let lineIndex = 0;
      for (const text of raw.split("\n")) {
        if (/^[ +\-]/.test(text)) lineIndex += 1;
        if (text === "\\ No newline at end of file") {
          const line = block.lines[lineIndex - 1];
          if (line?.oldNumber !== undefined) noNewline.add(`old:${line.oldNumber}`);
          if (line?.newNumber !== undefined) noNewline.add(`new:${line.newNumber}`);
        }
      }
      const changes = diffArrays<DiffLine>(oldLines, newLines, {
        comparator: (left, right) =>
          withoutSpaces(left.content.slice(1)) === withoutSpaces(right.content.slice(1)) &&
          noNewline.has(`old:${left.oldNumber}`) === noNewline.has(`new:${right.newNumber}`),
        timeout: 50,
      });
      if (changes) {
        const lines: DiffLine[] = [];
        let oldIndex = 0;
        let newIndex = 0;
        for (const change of changes) {
          for (let index = 0; index < change.count; index += 1) {
            if (change.removed) {
              const line = oldLines[oldIndex];
              oldIndex += 1;
              lines.push({
                content: line.content.replace(/^./, "-"),
                oldNumber: line.oldNumber!,
                type: LineType.DELETE,
                newNumber: undefined,
              });
            } else if (change.added) {
              const line = newLines[newIndex];
              newIndex += 1;
              lines.push({
                content: line.content.replace(/^./, "+"),
                newNumber: line.newNumber!,
                type: LineType.INSERT,
                oldNumber: undefined,
              });
            } else {
              const old = oldLines[oldIndex];
              const next = newLines[newIndex];
              oldIndex += 1;
              newIndex += 1;
              lines.push({
                type: LineType.CONTEXT,
                oldNumber: old.oldNumber!,
                newNumber: next.newNumber!,
                content: ` ${next.content.slice(1)}`,
              });
            }
          }
        }
        const hasChanges = lines.some((line) => line.type !== LineType.CONTEXT);
        block.lines = hasChanges ? lines : [];
        if (!hasChanges) block.header += " · Whitespace-only changes hidden";
      }
    }
    file.addedLines = file.blocks
      .flatMap((block) => block.lines)
      .filter((line) => line.type === LineType.INSERT).length;
    file.deletedLines = file.blocks
      .flatMap((block) => block.lines)
      .filter((line) => line.type === LineType.DELETE).length;
  }
  return files;
}
