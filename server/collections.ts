import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, isAbsolute, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { importVisuals, visualType } from "./visual-assets.ts";
import type { Collection, Review, ReviewReceipt, ReviewVisual } from "../src/review-types.ts";
import { briefSchema, type FeatureBrief } from "../src/brief-types.ts";

import { parsePullRequest } from "../src/pull-requests.ts";

const home = (name: string) => join(homedir(), name);
// Keeps the collections and receipts saved before the app was renamed.
export const dataDirectory = () =>
  process.env.PREREAD_DATA_DIR ||
  (existsSync(home(".worktree-review")) && !existsSync(home(".preread"))
    ? home(".worktree-review")
    : home(".preread"));
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value))
    throw new Error("IDs must use lowercase letters, numbers and hyphens (80 characters maximum).");
  return value;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
};
// A misspelled optional field would otherwise import as a review with no groups or ranges.
const fields = (value: unknown, allowed: string[], location: string) => {
  const result = object(value);
  const unknown = Object.keys(result).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Unknown field “${unknown}” in ${location}.`);
  return result;
};
const text = (value: unknown, label: string, max = 10000): string => {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${label}.`);
  return value;
};
const list = (value: unknown, label: string, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
};
const title = (value: unknown) => {
  const result = text(value, "title", 200).trim();
  if (!result) throw new Error("A title is required.");
  return result;
};
const unique = (items: { id: string }[], label: string) => {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error(`Duplicate ${label} IDs.`);
};
const visuals = (input: unknown, location: string): ReviewVisual[] | undefined => {
  if (input === undefined) return undefined;
  const result = list(input, "visuals", 12).map((item) => {
    const visual = fields(item, ["id", "title", "path", "caption"], location);
    const path = text(visual.path, "visual path", 4000);
    if (!isAbsolute(path)) throw new Error("Visual paths must be absolute local paths.");
    visualType(path);
    return { id: identifier(visual.id), title: title(visual.title), path,
      ...(visual.caption !== undefined ? { caption: text(visual.caption, "visual caption", 2000) } : {}) };
  });
  unique(result, "visual");
  return result;
};
// Issue paths name the review, since one manifest can carry many briefs with the same block IDs.
const reviewBrief = (value: unknown, index: number) => {
  const result = briefSchema.safeParse(value);
  if (!result.success)
    throw new z.ZodError(result.error.issues.map((issue) => ({ ...issue, path: ["reviews", index, "brief", ...issue.path] })));
  return result.data;
};
function validateBrief(brief: FeatureBrief, reviews: Pick<Review, "id" | "groups">[]) {
  for (const block of brief.blocks) {
    if (block.kind === "visual") {
      if (!isAbsolute(block.visual.path)) throw new Error("Brief visual paths must be absolute local paths.");
      visualType(block.visual.path);
    }
    if (block.kind === "code" && block.reference) {
      const { reference } = block;
      const group = reviews.find((review) => review.id === reference.review)?.groups.find((group) => group.id === reference.group);
      if (!group)
        throw new Error(`Brief code reference ${reference.review}/${reference.group} does not name an existing group.`);
      if (reference.file && !group.targets.some((target) => target.path === reference.file?.path))
        throw new Error("The excerpt’s source file must belong to its referenced group.");
    }
  }
}
export function validateCollection(input: unknown): Collection {
  const value = fields(input, ["id", "title", "description", "reviews", "brief"], "the collection");
  const reviews = list(value.reviews, "reviews", 100).map((inputReview, reviewIndex): Collection["reviews"][number] => {
    const location = `reviews[${reviewIndex}]`;
    const review = fields(
      inputReview,
      ["id", "title", "description", "path", "base", "mode", "scope", "groups", "pullRequest", "visuals", "brief"],
      location,
    );
    const path = text(review.path, "worktree path");
    if (!isAbsolute(path)) throw new Error("Worktree paths must be absolute.");
    if (!["branch", "all", "working", "staged"].includes(String(review.mode)))
      throw new Error("Invalid review mode.");
    if (review.scope !== undefined && review.scope !== "comparison" && review.scope !== "groups")
      throw new Error("Review scope must be comparison or groups.");
    const base = text(review.base, "base", 300);
    if (!base.trim() && (review.mode === "branch" || review.mode === "all"))
      throw new Error(`${location} needs a base branch or commit.`);
    const groups = list(review.groups ?? [], "groups", 100).map((inputGroup, groupIndex) => {
      const groupLocation = `${location}.groups[${groupIndex}]`;
      const group = fields(inputGroup, ["id", "title", "description", "targets", "visuals"], groupLocation);
      const id = identifier(group.id);
      if (id === "other-changes") throw new Error("The group ID other-changes is reserved.");
      const targets = list(group.targets, "group targets", 2000).map((inputTarget, targetIndex) => {
        const targetLocation = `${groupLocation}.targets[${targetIndex}]`;
        const target = fields(inputTarget, ["path", "ranges"], targetLocation);
        const name = text(target.path, "file path");
        if (isAbsolute(name) || name.split("/").some((part) => ["", ".", ".."].includes(part)))
          throw new Error("Group files must be repository-relative paths, such as src/app.ts.");
        const ranges =
          target.ranges === undefined
            ? undefined
            : list(target.ranges, "line ranges", 500).map((inputRange) => {
                const range = fields(inputRange, ["side", "start", "end"], targetLocation);
                if (
                  !["old", "new"].includes(String(range.side)) ||
                  !Number.isSafeInteger(range.start) ||
                  !Number.isSafeInteger(range.end) ||
                  Number(range.start) < 1 ||
                  Number(range.end) < Number(range.start)
                )
                  throw new Error(
                    "Line ranges need an old/new side and positive, ordered line numbers.",
                  );
                return {
                  side: range.side as "old" | "new",
                  start: Number(range.start),
                  end: Number(range.end),
                };
              });
        if (ranges && !ranges.length) throw new Error("Omit ranges to include a whole file.");
        return { path: name, ...(ranges ? { ranges } : {}) };
      });
      if (!targets.length) throw new Error(`${groupLocation} needs at least one target.`);
      return {
        id,
        title: title(group.title),
        description: text(group.description ?? "", "group description"),
        targets,
        ...(group.visuals !== undefined ? { visuals: visuals(group.visuals, groupLocation) } : {}),
      };
    });
    unique(groups, "group");
    if (review.scope === "groups" && !groups.length)
      throw new Error(`${location} needs at least one group for group-only scope.`);
    return {
      id: identifier(review.id),
      title: title(review.title),
      description: text(review.description ?? "", "review description"),
      path,
      base,
      mode: review.mode as Collection["reviews"][number]["mode"],
      ...(review.scope !== undefined ? { scope: review.scope } : {}),
      groups,
      ...(review.visuals !== undefined ? { visuals: visuals(review.visuals, location) } : {}),
      ...(review.pullRequest
        ? { pullRequest: parsePullRequest(text(review.pullRequest, "pull request URL", 2000)).url }
        : {}),
      ...(review.brief !== undefined ? { brief: reviewBrief(review.brief, reviewIndex) } : {}),
    };
  });
  unique(reviews, "review");
  if (!reviews.length) throw new Error("A collection needs at least one review.");
  const brief = value.brief === undefined ? undefined : briefSchema.parse(value.brief);
  if (brief) validateBrief(brief, reviews);
  for (const review of reviews) {
    try {
      if (review.brief) validateBrief(review.brief, reviews);
    } catch (error) {
      throw new Error(`The brief for review “${review.id}”: ${(error as Error).message}`);
    }
  }
  return {
    id: identifier(value.id),
    title: title(value.title),
    description: text(value.description ?? "", "collection description"),
    reviews,
    ...(brief ? { brief } : {}),
  };
}
const fileFor = (id: string) => join(dataDirectory(), "collections", `${identifier(id)}.json`);
const briefFileFor = (id: string) => join(dataDirectory(), "briefs", `${identifier(id)}.json`);
// One file per review brief, so writing one review's brief can never overwrite another's.
const reviewBriefFileFor = (id: string, review: string) =>
  join(dataDirectory(), "briefs", identifier(id), `${identifier(review)}.json`);
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
// Every request reads every brief in its collection, so a parsed brief is reused until its file is replaced.
const parsedBriefs = new Map<string, { version: string; brief: FeatureBrief }>();
async function readBrief(path: string) {
  try {
    const info = await stat(path);
    const version = `${info.ino}:${info.size}:${info.mtimeMs}`;
    const cached = parsedBriefs.get(path);
    if (cached?.version === version) return cached.brief;
    const brief = briefSchema.parse(JSON.parse(await readFile(path, "utf8")));
    parsedBriefs.set(path, { version, brief });
    return brief;
  } catch (error) {
    if (missing(error)) return undefined;
    // An unreadable brief hides only itself, so the collection's code and its other briefs stay reviewable.
    console.warn(`Skipped brief ${path}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}
// Briefs of reviews that left the collection stay on disk and return if the review does.
async function readReviewBriefs(id: string, reviews: Review[]) {
  const names = new Set(await readdir(join(dataDirectory(), "briefs", identifier(id))).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  ));
  const briefs = await Promise.all(reviews.filter((review) => names.has(`${review.id}.json`))
    .map(async (review) => [review.id, await readBrief(reviewBriefFileFor(id, review.id))] as const));
  return new Map(briefs.filter((entry): entry is readonly [string, FeatureBrief] => !!entry[1]));
}
export async function readCollection(id: string): Promise<Collection> {
  const collection = validateCollection(JSON.parse(await readFile(fileFor(id), "utf8")));
  const [brief, reviewBriefs] = await Promise.all([readBrief(briefFileFor(id)), readReviewBriefs(id, collection.reviews)]);
  return {
    ...collection,
    reviews: collection.reviews.map((review) => {
      const stored = reviewBriefs.get(review.id);
      return stored ? { ...review, brief: stored } : review;
    }),
    ...(brief ? { brief } : {}),
  };
}
export async function listCollections() {
  const names = await readdir(join(dataDirectory(), "collections")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const files = names.filter((name) => /^[a-z0-9][a-z0-9-]{0,79}\.json$/.test(name)).sort();
  const results = await Promise.allSettled(files.map((name) => readCollection(name.slice(0, -5))));
  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    console.warn(`Skipped collection ${files[index]}: ${(result.reason as Error).message}`);
    return [];
  });
}
async function atomicWrite(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}
async function importBriefVisuals(brief: FeatureBrief) {
  for (const block of brief.blocks) {
    if (block.kind === "visual") {
      const imported = await importVisuals([block.visual], dataDirectory());
      if (imported) block.visual = imported[0];
    }
  }
}
async function writeBrief(path: string, brief: FeatureBrief) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await atomicWrite(path, brief);
}
async function storeBrief(path: string, brief: FeatureBrief) {
  await importBriefVisuals(brief);
  await writeBrief(path, brief);
}
// Only the new brief is checked, so a stale link in another brief can't block this write.
export async function putCollectionBrief(id: string, input: unknown, review?: string) {
  const brief = briefSchema.parse(input);
  const { reviews } = await readCollection(id);
  if (review !== undefined && !reviews.some((entry) => entry.id === identifier(review)))
    throw new Error(`No review has the ID “${review}” in this collection.`);
  validateBrief(brief, reviews);
  await storeBrief(review === undefined ? briefFileFor(id) : reviewBriefFileFor(id, review), brief);
  return readCollection(id);
}
export async function putCollection(input: unknown) {
  const collection = validateCollection(input);
  for (const review of collection.reviews) {
    if (review.visuals) review.visuals = await importVisuals(review.visuals, dataDirectory());
    for (const group of review.groups)
      if (group.visuals) group.visuals = await importVisuals(group.visuals, dataDirectory());
  }
  const { brief, ...metadata } = collection;
  // Every visual is copied before any brief is written, so a missing GIF can't leave a half-replaced import.
  const briefs = [
    ...(brief ? [{ path: briefFileFor(collection.id), brief }] : []),
    ...collection.reviews.flatMap((review) => review.brief ? [{ path: reviewBriefFileFor(collection.id, review.id), brief: review.brief }] : []),
  ];
  for (const entry of briefs) await importBriefVisuals(entry.brief);
  for (const entry of briefs) await writeBrief(entry.path, entry.brief);
  await mkdir(join(dataDirectory(), "collections"), { recursive: true, mode: 0o700 });
  await atomicWrite(fileFor(collection.id), { ...metadata, reviews: metadata.reviews.map(({ brief: _brief, ...review }) => review) });
  return readCollection(collection.id);
}
// Receipts and Viewed baselines stay, so importing the same ID again restores them.
export async function deleteCollection(id: string) {
  await unlink(fileFor(id)).catch((error: NodeJS.ErrnoException) => {
    throw error.code === "ENOENT" ? new Error(`No collection has the ID “${id}”.`) : error;
  });
}
export const receiptKey = (reviewId: string, groupId: string) =>
  `${identifier(reviewId)}/${identifier(groupId)}`;
export async function readReceipts(collectionId: string): Promise<Record<string, ReviewReceipt>> {
  const path = join(dataDirectory(), "reviews", `${identifier(collectionId)}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
// Serializing the read/modify/write preserves clicks from multiple open tabs.
let writes: Promise<unknown> = Promise.resolve();
export function setReceipt(
  collectionId: string,
  reviewId: string,
  groupId: string,
  fingerprint: string | null,
) {
  const operation = writes.then(async () => {
    const receipts = await readReceipts(collectionId);
    const key = receiptKey(reviewId, groupId);
    if (fingerprint) receipts[key] = { fingerprint, reviewedAt: new Date().toISOString() };
    else delete receipts[key];
    await mkdir(join(dataDirectory(), "reviews"), { recursive: true, mode: 0o700 });
    await atomicWrite(
      join(dataDirectory(), "reviews", `${identifier(collectionId)}.json`),
      receipts,
    );
    return receipts[key] ?? null;
  });
  writes = operation.catch(() => {});
  return operation;
}
