import { z } from "zod";
import type { BriefReference } from "./brief-types";
import { threadCommandSchemas, type Threads } from "./threads";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
// z.uuid() accepts capitals, but comment files are found by a lowercase name.
export const commentId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "A comment ID is a lowercase UUID.");
const plain = (max: number, message?: string) => z.string().max(max, message).refine((value) => !value.includes("\0"));
const repositoryPath = plain(4000).refine((value) => !value.startsWith("/") && !value.includes("\\") && !/^[a-z]:/i.test(value)
  && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "Use a repository-relative file path.");
const body = plain(12000, "Keep a comment under 12,000 characters.").refine((value) => !!value.trim(), "Write a comment.");
const maxLineText = 4000;
// Minified and data lines run past the cap, so a line is stored and matched by its start.
export const clipLine = (text: string) => text.slice(0, maxLineText);
export const codeLineSchema = z.strictObject({ side: z.enum(["old", "new"]), number: z.number().int().positive(), text: plain(maxLineText) });
export const codeCommentSchema = z.strictObject({
  id: commentId, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  group: id, path: repositoryPath, line: codeLineSchema.optional(), body,
});
export const codeCommentCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("save"), id: commentId, group: id, path: repositoryPath, line: codeLineSchema.optional(), body }),
  z.strictObject({ kind: z.literal("delete"), id: commentId }),
  ...threadCommandSchemas(commentId),
]);
export type CodeCommentState = { comments: CodeComment[]; threads: Threads };
export type CodeLine = z.infer<typeof codeLineSchema>;
export type CodeComment = z.infer<typeof codeCommentSchema>;
export type CodeCommentCommand = z.infer<typeof codeCommentCommandSchema>;
export type CodeJump = BriefReference & { comment?: { line?: CodeLine } };

export const lineKey = (line: Pick<CodeLine, "side" | "number">) => `${line.side}:${line.number}`;
// A comment follows its line's text when edits above it move the line; with no single match it shows under the file.
export function anchorLine(line: CodeLine, lines: ReadonlyMap<string, string> | null) {
  if (!lines) return "";
  const key = lineKey(line);
  const text = lines.get(key);
  if (text !== undefined && clipLine(text) === line.text) return key;
  let found = "";
  for (const [candidate, value] of lines) {
    if (!candidate.startsWith(`${line.side}:`) || clipLine(value) !== line.text) continue;
    if (found) return "";
    found = candidate;
  }
  return found;
}
type CardSection = { id: string; files: ReadonlyArray<{ file: { path: string; oldPath?: string } }> };
export const cardKey = (group: string, path: string) => `${group}\n${path}`;
// Comments follow a file the agent moves to another group or renames.
export function commentCard(group: string, path: string, sections: ReadonlyArray<CardSection>) {
  const holding = (match: (file: { path: string; oldPath?: string }) => boolean) => sections.flatMap((section) =>
    section.files.filter(({ file }) => match(file)).map(({ file }) => ({ group: section.id, path: file.path })));
  const candidates = [holding((file) => file.path === path), holding((file) => file.oldPath === path)].find((list) => list.length) ?? [];
  return candidates.find((entry) => entry.group === group) ?? candidates[0];
}
export function placeComments(comments: CodeComment[], sections: ReadonlyArray<CardSection>) {
  const cards = new Map<string, CodeComment[]>();
  const unplaced: CodeComment[] = [];
  for (const comment of comments) {
    const card = commentCard(comment.group, comment.path, sections);
    if (!card) { unplaced.push(comment); continue; }
    const key = cardKey(card.group, card.path);
    cards.set(key, [...(cards.get(key) ?? []), comment]);
  }
  return { cards, unplaced };
}
type ShownFiles = { sections: ReadonlyArray<{ id: string; files: ReadonlyArray<{ path: string }> }> };
export function reviewsShowing<TReview extends { id: string }>(path: string, reviews: ReadonlyArray<TReview>,
  sources: Readonly<Record<string, ShownFiles>>) {
  return reviews.flatMap((review) => {
    const group = sources[review.id]?.sections.find((section) => section.files.some((file) => file.path === path))?.id;
    return group ? [{ review, group }] : [];
  });
}
export function sourceLine(line: CodeLine, code: string) {
  const lines = new Map(code.split("\n").map((text, index) => [lineKey({ side: line.side, number: index + 1 }), text.replace(/\r$/, "")]));
  const key = anchorLine(line, lines);
  return key ? Number(key.split(":")[1]) : line.number;
}

// Context lines are keyed on the new side only, so a line has one key whichever column was clicked.
// A CRLF file's lines keep their CR here, but diff2html drops it, so the text is stored without it.
export function patchLines(patch: string) {
  const lines = new Map<string, string>();
  let oldLine = 0, newLine = 0, oldLeft = 0, newLeft = 0;
  for (const raw of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (header) {
      [oldLine, oldLeft, newLine, newLeft] = [Number(header[1]), Number(header[2] ?? 1), Number(header[3]), Number(header[4] ?? 1)];
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) continue;
    const text = raw.slice(1).replace(/\r$/, "");
    if (raw[0] === " ") { lines.set(`new:${newLine}`, text); oldLine += 1; newLine += 1; oldLeft -= 1; newLeft -= 1; }
    else if (raw[0] === "+") { lines.set(`new:${newLine}`, text); newLine += 1; newLeft -= 1; }
    else if (raw[0] === "-") { lines.set(`old:${oldLine}`, text); oldLine += 1; oldLeft -= 1; }
  }
  return lines;
}

export function sortCodeComments(comments: CodeComment[]) {
  return [...comments].sort((a, b) => a.path.localeCompare(b.path) || (a.line?.number ?? 0) - (b.line?.number ?? 0)
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export const codeCommentPlace = (comment: CodeComment) => !comment.line ? `${comment.path} (whole file)`
  : `${comment.path}:${comment.line.number}${comment.line.side === "old" ? " (removed line)" : ""}`;
export const lineText = (line: CodeLine) => line.text.trim() ? line.text : "(blank line)";
