import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Collection, ReviewReceipt } from "../src/review-types.ts";

import { parsePullRequest } from "../src/pull-requests.ts";

export const dataDirectory = () =>
  process.env.WORKTREE_REVIEW_DATA_DIR || join(homedir(), ".worktree-review");
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
export function validateCollection(input: unknown): Collection {
  const value = object(input);
  const reviews = list(value.reviews, "reviews", 100).map((inputReview) => {
    const review = object(inputReview);
    const path = text(review.path, "worktree path");
    if (!isAbsolute(path)) throw new Error("Worktree paths must be absolute.");
    if (!["branch", "all", "working", "staged"].includes(String(review.mode)))
      throw new Error("Invalid review mode.");
    const groups = list(review.groups ?? [], "groups", 100).map((inputGroup) => {
      const group = object(inputGroup);
      const id = identifier(group.id);
      if (id === "other-changes") throw new Error("The group ID other-changes is reserved.");
      const targets = list(group.targets, "group targets", 2000).map((inputTarget) => {
        const target = object(inputTarget);
        const name = text(target.path, "file path");
        if (!name || isAbsolute(name) || name.split("/").includes(".."))
          throw new Error("Group files must be repository-relative paths.");
        const ranges =
          target.ranges === undefined
            ? undefined
            : list(target.ranges, "line ranges", 500).map((inputRange) => {
                const range = object(inputRange);
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
      return {
        id,
        title: title(group.title),
        description: text(group.description ?? "", "group description"),
        targets,
      };
    });
    unique(groups, "group");
    return {
      id: identifier(review.id),
      title: title(review.title),
      description: text(review.description ?? "", "review description"),
      path,
      base: text(review.base, "base", 300),
      mode: review.mode as Collection["reviews"][number]["mode"],
      groups,
      ...(review.pullRequest
        ? { pullRequest: parsePullRequest(text(review.pullRequest, "pull request URL", 2000)).url }
        : {}),
    };
  });
  unique(reviews, "review");
  if (!reviews.length) throw new Error("A collection needs at least one review.");
  return {
    id: identifier(value.id),
    title: title(value.title),
    description: text(value.description ?? "", "collection description"),
    reviews,
  };
}
const fileFor = (id: string) => join(dataDirectory(), "collections", `${identifier(id)}.json`);
export const readCollection = async (id: string) =>
  validateCollection(JSON.parse(await readFile(fileFor(id), "utf8")));
export async function listCollections() {
  const names = await readdir(join(dataDirectory(), "collections")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return Promise.all(
    names
      .filter((name) => /^[a-z0-9][a-z0-9-]{0,79}\.json$/.test(name))
      .sort()
      .map((name) => readCollection(name.slice(0, -5))),
  );
}
async function atomicWrite(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}
export async function putCollection(input: unknown) {
  const collection = validateCollection(input);
  await mkdir(join(dataDirectory(), "collections"), { recursive: true, mode: 0o700 });
  await atomicWrite(fileFor(collection.id), collection);
  return collection;
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
