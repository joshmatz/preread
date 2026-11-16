import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { dataDirectory, readCollection } from "./collections.ts";
import { codeCommentCommandSchema, codeCommentSchema, commentId, sortCodeComments, type CodeComment } from "../src/code-comments.ts";

const collectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const commentFile = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
const directory = (collection: string, review: string) =>
  join(dataDirectory(), "code-comments", collectionId.parse(collection), collectionId.parse(review));
const fileFor = (collection: string, review: string, id: string) => join(directory(collection, review), `${commentId.parse(id)}.json`);
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

async function readComment(collection: string, review: string, id: string) {
  try {
    const comment = codeCommentSchema.parse(JSON.parse(await readFile(fileFor(collection, review, id), "utf8")));
    if (comment.id !== id) throw new Error("This comment does not match its file name.");
    return comment;
  } catch (error) { if (missing(error)) return null; throw error; }
}
export async function readCodeComments(collection: string, review: string): Promise<CodeComment[]> {
  const names = await readdir(directory(collection, review)).catch((error) => { if (missing(error)) return []; throw error; });
  const comments = await Promise.all(names.filter((name) => commentFile.test(name)).map(async (name) => {
    try { return await readComment(collection, review, name.slice(0, -5)); }
    catch (error) {
      // A damaged file must not hide every other comment on the review.
      console.warn(`Skipped code comment ${name} in ${collection}/${review}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }));
  return sortCodeComments(comments.filter((comment) => comment !== null));
}
async function requireReview(collection: string, review: string) {
  const entry = (await readCollection(collection)).reviews.find((candidate) => candidate.id === review);
  if (!entry) throw new Error("That review is not in this collection.");
  return entry;
}
export async function codeComments(collection: string, review: string) {
  await requireReview(collection, review);
  return readCodeComments(collection, review);
}
export async function saveCodeComment(collection: string, review: string, input: unknown) {
  const command = codeCommentCommandSchema.parse(input);
  const entry = await requireReview(collection, review);
  if (command.kind === "delete") {
    await unlink(fileFor(collection, review, command.id)).catch((error) => { if (!missing(error)) throw error; });
    return readCodeComments(collection, review);
  }
  const previous = await readComment(collection, review, command.id);
  if (previous && (previous.group !== command.group || previous.path !== command.path || JSON.stringify(previous.line) !== JSON.stringify(command.line)))
    throw new Error("Editing a comment cannot move it to another line.");
  if (!previous && command.group !== "other-changes" && !entry.groups.some((group) => group.id === command.group))
    throw new Error("That group is not in this review.");
  const now = new Date().toISOString();
  const value = codeCommentSchema.parse({ id: command.id, createdAt: previous?.createdAt ?? now, updatedAt: now, group: command.group,
    path: command.path, ...(command.line ? { line: command.line } : {}), body: command.body.trim() });
  await mkdir(directory(collection, review), { recursive: true, mode: 0o700 });
  const file = fileFor(collection, review, value.id);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, file);
  return readCodeComments(collection, review);
}
