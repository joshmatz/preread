import type { FilePreview } from "./review-types";

export interface PathPart {
  text: string;
  changed: boolean;
}

// Folders keep their slash and extensions their dot, so a move marks "lib/" rather than "/lib".
const pathTokens = (path: string) => path.match(/[^/]*\/|[^/.]+|\.[^/.]*/g) ?? [];
const append = (parts: PathPart[], text: string, changed: boolean) => {
  const last = parts.at(-1);
  if (last?.changed === changed) last.text += text;
  else parts.push({ text, changed });
};

export function pathDiff(from: string, to: string) {
  const a = pathTokens(from);
  const b = pathTokens(to);
  const common = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i][j] =
        a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const before: PathPart[] = [];
  const after: PathPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      append(before, a[i++], false);
      append(after, b[j++], false);
    } else if (j === b.length || (i < a.length && common[i + 1][j] >= common[i][j + 1]))
      append(before, a[i++], true);
    else append(after, b[j++], true);
  }
  return { before, after };
}

// diff2html draws "File without changes" for any patch without hunks, even a rename or mode change.
export function noContentNote(patch: string) {
  if (!patch || /^(@@ |Binary files )/m.test(patch)) return "";
  if (/^(new|deleted) file mode /m.test(patch)) return "Empty file.";
  const mode = /^old mode (\d+)\nnew mode (\d+)$/m.exec(patch);
  return mode
    ? `File mode changed from ${mode[1]} to ${mode[2]}. No content changes.`
    : "No content changes.";
}

// Git counts a binary file as binary even when a rename leaves its content untouched.
export const reviewable = ({ error, diff }: FilePreview) =>
  !error && !diff.tooLarge && (!diff.binary || !!diff.image || !!noContentNote(diff.patch));
