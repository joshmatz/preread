import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { dataDirectory, readCollection } from "./collections.ts";
import { visualAsset } from "./visual-assets.ts";
import { briefCommandSchema, briefFeedbackSchema, type BriefAnchor, type BriefAttention, type BriefBlock, type BriefFeedback, type BriefSnapshot, type CollectionAttention, type FeatureBrief } from "../src/brief-types.ts";
import type { Collection } from "../src/review-types.ts";
import { blockTitle, feedbackCurrent } from "../src/brief-feedback.ts";
import { threadCounts, type ThreadCounts, type Threads } from "../src/threads.ts";
import { readCommentImage, commentImageAsset } from "./comment-images.ts";
import { readCodeCommentState } from "./code-comments.ts";
import { editedAt, personCommand, readThreads, removeThread } from "./threads.ts";

const collectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const entryId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// A review brief's entries live in a subfolder, which the collection brief's reader skips because it lists only .json files.
export const feedbackStore = (collection: string, review?: string) => {
  const root = join(dataDirectory(), "brief-feedback", collectionId.parse(collection));
  return review === undefined ? root : join(root, "reviews", collectionId.parse(review));
};
const directory = feedbackStore;
const fileFor = (collection: string, id: string, review?: string) => join(directory(collection, review), `${entryId.parse(id)}.json`);
async function readEntry(collection: string, id: string, review?: string) {
  try {
    const entry = briefFeedbackSchema.parse(JSON.parse(await readFile(fileFor(collection, id, review), "utf8")));
    if (entry.id !== id) throw new Error("This feedback does not match its file name.");
    return entry;
  } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}
async function readFeedback(collection: string, review?: string) {
  const names = await readdir(directory(collection, review)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []; throw error;
  });
  const entries = await Promise.all(names.filter((name) => /^[a-z0-9][a-z0-9-]{0,159}\.json$/.test(name))
    .map((name) => readEntry(collection, name.slice(0, -5), review).catch((error) => {
      console.warn(`Skipped feedback ${name} in ${collection}${review ? `/${review}` : ""}: ${error instanceof Error ? error.message : error}`);
      return null;
    })));
  return entries.filter((entry) => entry !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
async function readStore(collection: string, review?: string) {
  const feedback = await readFeedback(collection, review);
  return { feedback, threads: await readThreads(directory(collection, review), feedback.map((entry) => entry.id)) };
}
function briefFor(current: Collection, review?: string) {
  if (review === undefined) {
    if (!current.brief) throw new Error("This collection has no feature brief.");
    return { brief: current.brief, title: current.title };
  }
  const entry = current.reviews.find((candidate) => candidate.id === review);
  if (!entry) throw new Error("That review is not in this collection.");
  if (!entry.brief) throw new Error("This review has no brief.");
  return { brief: entry.brief, title: entry.title };
}
const snapshotOf = (brief: FeatureBrief, { feedback, threads }: { feedback: BriefFeedback[]; threads: Threads }): BriefSnapshot => ({ brief, version: hash(brief),
  fingerprints: Object.fromEntries(brief.blocks.map((block) => [block.id, hash(block)])), feedback, threads });
export function briefAttention(snapshot: BriefSnapshot): BriefAttention {
  const current = snapshot.feedback.filter((entry) => feedbackCurrent(entry, snapshot));
  const done = (kind: "answer" | "approval", block: string) => current.some((entry) => entry.kind === kind && entry.block.id === block);
  return {
    questions: snapshot.brief.blocks.flatMap((block) => block.kind === "question" && !done("answer", block.id)
      ? [{ block: block.id, question: block.question }] : []),
    approvals: snapshot.brief.blocks.flatMap((block) => block.kind === "code" && block.approval && !done("approval", block.id)
      ? [{ block: block.id, title: blockTitle(block) }] : []),
    threads: threadCounts(snapshot.feedback, snapshot.threads),
  };
}
// `known` is the brief being shown, whose feedback was just read.
async function collectionAttention(current: Collection, known: { review?: string; snapshot: BriefSnapshot }): Promise<CollectionAttention> {
  const attentionOf = async (brief: FeatureBrief, review?: string) => {
    if (known.review === review) return briefAttention(known.snapshot);
    try { return briefAttention(snapshotOf(brief, await readStore(current.id, review))); }
    catch (error) {
      // One unreadable entry elsewhere must not block this brief, or report a save that succeeded as failed.
      console.warn(`Skipped attention for ${review ?? "the feature brief"} in ${current.id}: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  };
  const [feature, reviews, comments] = await Promise.all([
    current.brief ? attentionOf(current.brief) : undefined,
    Promise.all(current.reviews.flatMap((review) => review.brief ? [attentionOf(review.brief, review.id).then((value) => [review.id, value] as const)] : [])),
    Promise.all(current.reviews.map((review) => readCodeCommentState(current.id, review.id).then(({ comments, threads }) =>
      [review.id, comments.length ? threadCounts(comments, threads) : undefined] as const, (error) => {
        console.warn(`Skipped code comments for ${review.id} in ${current.id}: ${error instanceof Error ? error.message : error}`);
        return [review.id, undefined] as const;
      }))),
  ]);
  const code = Object.fromEntries(comments.filter((entry): entry is readonly [string, ThreadCounts] => !!entry[1]));
  return { ...(feature ? { feature } : {}), reviews: Object.fromEntries(reviews.filter((entry): entry is readonly [string, BriefAttention] => !!entry[1])),
    ...(Object.keys(code).length ? { code } : {}) };
}
export async function storedBriefSnapshot(current: Collection, review?: string) {
  return snapshotOf(briefFor(current, review).brief, await readStore(current.id, review));
}
export async function briefSnapshot(collection: string, review?: string): Promise<BriefSnapshot> {
  const current = await readCollection(collection);
  const snapshot = await storedBriefSnapshot(current, review);
  return { ...snapshot, attention: await collectionAttention(current, { review, snapshot }) };
}
function requireBlock(snapshot: BriefSnapshot, id: string, revision: string) {
  const block = snapshot.brief.blocks.find((entry) => entry.id === id);
  if (!block || snapshot.fingerprints[id] !== revision)
    throw new Error("This part of the brief changed. Refresh it before saving feedback.");
  return block;
}
function validateAnchor(anchor: BriefAnchor, snapshot: BriefSnapshot, title: string): BriefAnchor {
  if (anchor.kind === "document") {
    if (anchor.revision !== snapshot.version) throw new Error("The brief changed. Refresh it before commenting.");
    return { ...anchor, title };
  }
  if (anchor.kind === "block") {
    return { ...anchor, title: blockTitle(requireBlock(snapshot, anchor.block, anchor.revision)) };
  }
  for (const segment of anchor.segments) {
    const block = requireBlock(snapshot, segment.block, segment.revision);
    const expected = block.kind === "visual" ? "caption" : block.kind;
    if (segment.part !== expected) throw new Error("This selection does not match its brief block.");
    if (!segment.text.slice(segment.start, segment.end).trim()) throw new Error("Select some text before commenting.");
    const source = block.kind === "code" ? block.code : block.kind === "visual" ? block.visual.caption ?? ""
      : block.kind === "question" ? block.question + (block.description ?? "") : null;
    if (source !== null && source !== segment.text) throw new Error("The selected text changed. Select it again.");
  }
  return anchor;
}
export async function saveBriefFeedback(collection: string, input: unknown, review?: string): Promise<BriefSnapshot> {
  const command = briefCommandSchema.parse(input);
  const current = await readCollection(collection);
  const { title } = briefFor(current, review);
  const snapshot = await storedBriefSnapshot(current, review);
  if (command.kind === "delete") {
    await unlink(fileFor(collection, command.id, review)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    await removeThread(directory(collection, review), command.id);
    return briefSnapshot(collection, review);
  }
  if (command.kind === "reply" || command.kind === "resolve" || command.kind === "reopen") {
    const root = await readEntry(collection, command.entry, review);
    if (!root || !await personCommand(directory(collection, review), root, command)) throw new Error("This feedback was removed.");
    return briefSnapshot(collection, review);
  }
  let value: BriefFeedback;
  if (command.kind === "comment") {
    const now = await editedAt(directory(collection, review), command.id);
    const previous = await readEntry(collection, command.id, review);
    if (previous && previous.kind !== "comment") throw new Error("This feedback entry is not a comment.");
    if (previous && JSON.stringify(previous.anchor) !== JSON.stringify(command.anchor))
      throw new Error("Editing a comment cannot move its anchor.");
    const body = command.body.trim();
    const attachments = await Promise.all(command.attachments.map((id) => readCommentImage(collection, id)));
    // Saving unchanged content must not reopen a resolved thread.
    const same = previous?.body === body && JSON.stringify(previous.attachments) === JSON.stringify(attachments);
    value = { kind: "comment", id: command.id, createdAt: previous?.createdAt ?? now, updatedAt: same ? previous.updatedAt : now,
      body, anchor: previous?.anchor ?? validateAnchor(command.anchor, snapshot, title), attachments };
  } else {
    const block = requireBlock(snapshot, command.block, command.revision);
    const id = `${command.kind === "answer" ? "answer" : "approval"}-${block.id}-${command.revision}`;
    const previous = await readEntry(collection, id, review);
    const now = await editedAt(directory(collection, review), id);
    const common = { id, createdAt: previous?.createdAt ?? now, updatedAt: now, revision: command.revision };
    if (command.kind === "answer") {
      if (block.kind !== "question") throw new Error("This block is not a question.");
      const answer = command.answer;
      if (answer.kind === "option" && !block.options.some((option) => option.id === answer.option))
        throw new Error("This option does not belong to the question.");
      const saved = answer.kind === "custom" ? { ...answer, text: answer.text.trim() } : answer;
      const same = previous?.kind === "answer" && JSON.stringify(previous.answer) === JSON.stringify(saved);
      value = { ...common, ...(same ? { updatedAt: previous.updatedAt } : {}), kind: "answer", block, answer: saved };
    } else {
      if (block.kind !== "code" || !block.approval) throw new Error("This excerpt does not request approval.");
      if (!command.approved) {
        await unlink(fileFor(collection, id, review)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
        await removeThread(directory(collection, review), id);
        return briefSnapshot(collection, review);
      }
      if (previous) return briefSnapshot(collection, review);
      value = { ...common, kind: "approval", block };
    }
  }
  const parsed = briefFeedbackSchema.parse(value);
  await mkdir(directory(collection, review), { recursive: true, mode: 0o700 });
  const file = fileFor(collection, value.id, review);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(parsed, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, file);
  return briefSnapshot(collection, review);
}
export async function readBriefVisual(collection: string, id: string, review?: string) {
  const current = await readCollection(collection);
  const brief = review === undefined ? current.brief : current.reviews.find((entry) => entry.id === review)?.brief;
  const block = brief?.blocks.find((entry): entry is Extract<BriefBlock, { kind: "visual" }> => entry.id === id && entry.kind === "visual");
  if (!block) throw new Error(`This visual is not in the ${review === undefined ? "feature" : "review"} brief.`);
  return visualAsset(block.visual.path, dataDirectory());
}
export async function readCommentAttachment(collection: string, comment: string, image: string, review?: string) {
  const entry = await readEntry(collection, comment, review);
  if (!entry || entry.kind !== "comment" || !entry.attachments.some((attachment) => attachment.id === image))
    throw new Error("This image is not attached to this comment.");
  return commentImageAsset(collection, image);
}
