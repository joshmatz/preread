import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, isAbsolute, extname } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { Collection, ReviewReceipt } from "../src/review-types.ts";
import { imageType, MAX_IMAGE } from "./git.ts";

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
const object = (value: unknown, location: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected an object for ${location}.`);
  return value as Record<string, unknown>;
};
// A misspelled optional field would otherwise import as a review with no groups or ranges.
const fields = (value: unknown, allowed: string[], location: string) => {
  const result = object(value, location);
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
const savedImage = /^[0-9a-f]{64}\.[a-z]+$/;
const link = (value: unknown, location: string) => {
  const result = text(value, `${location} link`, 2000);
  const url = URL.parse(result);
  if (url?.protocol !== "http:" && url?.protocol !== "https:")
    throw new Error(`${location} link must be an http or https URL.`);
  return result;
};
// Saved collections name images by content; only import reads an image from its original path.
const images = (value: unknown, prefix: string) => {
  const result = list(value ?? [], `${prefix}images list (at most 20)`, 20).map((input, index) => {
    const location = `${prefix}images[${index}]`;
    const image = fields(input, ["file", "caption", "link"], location);
    const file = image.file;
    if (typeof file !== "string" || !savedImage.test(file) || !imageType(file))
      throw new Error(`${location} isn’t a saved image. Import new images by path.`);
    const caption = text(
      image.caption ?? "",
      `${location} caption (at most 1,000 characters)`,
      1000,
    ).trim();
    return {
      file,
      ...(caption ? { caption } : {}),
      ...(image.link === undefined ? {} : { link: link(image.link, location) }),
    };
  });
  return result.length ? { images: result } : {};
};
export function validateCollection(input: unknown): Collection {
  const value = fields(
    input,
    ["id", "title", "description", "reviews", "images"],
    "the collection",
  );
  const reviews = list(value.reviews, "reviews", 100).map((inputReview, reviewIndex) => {
    const location = `reviews[${reviewIndex}]`;
    const review = fields(
      inputReview,
      ["id", "title", "description", "path", "base", "mode", "groups", "pullRequest", "images"],
      location,
    );
    const path = text(review.path, "worktree path");
    if (!isAbsolute(path)) throw new Error("Worktree paths must be absolute.");
    if (!["branch", "all", "working", "staged"].includes(String(review.mode)))
      throw new Error("Invalid review mode.");
    const base = text(review.base, "base", 300);
    if (!base.trim() && (review.mode === "branch" || review.mode === "all"))
      throw new Error(`${location} needs a base branch or commit.`);
    const groups = list(review.groups ?? [], "groups", 100).map((inputGroup, groupIndex) => {
      const groupLocation = `${location}.groups[${groupIndex}]`;
      const group = fields(
        inputGroup,
        ["id", "title", "description", "targets", "images"],
        groupLocation,
      );
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
        ...images(group.images, `${groupLocation}.`),
      };
    });
    unique(groups, "group");
    return {
      id: identifier(review.id),
      title: title(review.title),
      description: text(review.description ?? "", "review description"),
      path,
      base,
      mode: review.mode as Collection["reviews"][number]["mode"],
      groups,
      ...(review.pullRequest
        ? { pullRequest: parsePullRequest(text(review.pullRequest, "pull request URL", 2000)).url }
        : {}),
      ...images(review.images, `${location}.`),
    };
  });
  unique(reviews, "review");
  if (!reviews.length) throw new Error("A collection needs at least one review.");
  return {
    id: identifier(value.id),
    title: title(value.title),
    description: text(value.description ?? "", "collection description"),
    reviews,
    ...images(value.images, ""),
  };
}
const imageDirectory = () => join(dataDirectory(), "images");
const exists = (path: string) => stat(path).then(
  () => true,
  () => false,
);
// Catches an error page or other text saved under an image's name.
const imageStarts = ["\x89PNG\r\n\x1a\n", "\xff\xd8\xff", "GIF87a", "GIF89a", "BM", "\0\0\x01\0"];
const looksLikeImage = (head: string) =>
  imageStarts.some((start) => head.startsWith(start)) ||
  (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") ||
  head.slice(4, 8) === "ftyp";
async function checkImage(path: unknown, location: string) {
  if (typeof path !== "string" || !isAbsolute(path))
    throw new Error(`${location} needs an absolute image path.`);
  if (!imageType(path))
    throw new Error(`${location} must be a PNG, JPEG, GIF, WebP, AVIF, BMP, or ICO file.`);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`${location}: there’s no image file at ${path}.`);
  if (info.size > MAX_IMAGE) throw new Error(`${location} is over the 20 MB image limit.`);
  const handle = await open(path);
  const { buffer } = await handle.read({ buffer: Buffer.alloc(12) }).finally(() => handle.close());
  if (!looksLikeImage(buffer.toString("latin1")))
    throw new Error(`${location}: the file at ${path} isn’t an image.`);
  return path;
}
async function saveImage(path: string) {
  const content = await readFile(path);
  const file = `${createHash("sha256").update(content).digest("hex")}${extname(path).toLowerCase()}`;
  const target = join(imageDirectory(), file);
  if (!(await exists(target))) {
    await mkdir(imageDirectory(), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, target);
  }
  return file;
}
// Copies each image given by path into the data directory, so the manifest's files can be
// deleted after import. Nothing is copied unless the whole manifest is valid.
export async function saveImages(manifest: unknown) {
  const places: [unknown, string][] = [[manifest, ""]];
  const copies: [unknown[], number, string][] = [];
  const children = (value: unknown, key: string) => {
    const items = (value as Record<string, unknown> | null)?.[key];
    return Array.isArray(items) ? items : [];
  };
  children(manifest, "reviews").forEach((review, reviewIndex) => {
    places.push([review, `reviews[${reviewIndex}].`]);
    children(review, "groups").forEach((group, groupIndex) =>
      places.push([group, `reviews[${reviewIndex}].groups[${groupIndex}].`]),
    );
  });
  for (const [place, prefix] of places) {
    const attached = children(place, "images");
    for (const [index, image] of attached.entries()) {
      const location = `${prefix}images[${index}]`;
      if (!image || typeof image !== "object") continue;
      if ("path" in image) {
        if ("file" in image) throw new Error(`${location} needs a path or a file, not both.`);
        const { path, ...rest } = image;
        const source = await checkImage(path, location);
        // A stand-in name lets validation check the rest of the entry before anything is copied.
        attached[index] = { file: `${"0".repeat(64)}${extname(source).toLowerCase()}`, ...rest };
        copies.push([attached, index, source]);
      } else if (
        typeof image.file === "string" &&
        savedImage.test(image.file) &&
        !(await exists(join(imageDirectory(), image.file)))
      )
        throw new Error(
          `${location}: Preread has no saved image ${image.file}. Give new images a path.`,
        );
    }
  }
  validateCollection(manifest);
  for (const [attached, index, source] of copies)
    attached[index] = { ...(attached[index] as object), file: await saveImage(source) };
  return manifest;
}
export async function readImage(file: string) {
  const type = savedImage.test(file) && imageType(file);
  if (!type) throw new Error("Invalid image name.");
  const content = await readFile(join(imageDirectory(), file)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      throw new Error("This image is no longer saved. Import its collection again from the image’s path.");
    },
  );
  return { content, type };
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
