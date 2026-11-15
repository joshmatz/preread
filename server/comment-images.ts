import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { dataDirectory, readCollection } from "./collections.ts";
import { storeVisual, visualAsset, visualType } from "./visual-assets.ts";
import { commentImageSchema } from "../src/brief-types.ts";

const collectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const imageId = z.uuid();
const filename = z.string().min(1).max(200).refine((value) => !/[\x00-\x1f/\\]/.test(value), "Invalid image name.");
const directory = (collection: string) => join(dataDirectory(), "comment-images", collectionId.parse(collection));
// Images share one folder per collection; each comment, in whichever brief, names the images it attaches.
export async function storeCommentImage(collection: string, name: string, bytes: Buffer, review?: string) {
  const current = await readCollection(collection);
  if (review === undefined ? !current.brief : !current.reviews.find((entry) => entry.id === review)?.brief)
    throw new Error(review === undefined ? "This collection has no feature brief." : "This review has no brief.");
  filename.parse(name);
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(visualType(name)))
    throw new Error("Comment attachments must be PNG, JPEG, WebP, or GIF images.");
  const path = await storeVisual(bytes, name, dataDirectory());
  const image = commentImageSchema.parse({ id: randomUUID(), name, path });
  await mkdir(directory(collection), { recursive: true, mode: 0o700 });
  await writeFile(join(directory(collection), `${image.id}.json`), JSON.stringify(image) + "\n", { mode: 0o600, flag: "wx" });
  return image;
}
export async function readCommentImage(collection: string, id: string) {
  const image = commentImageSchema.parse(JSON.parse(await readFile(join(directory(collection), `${imageId.parse(id)}.json`), "utf8")));
  if (image.id !== id) throw new Error("This image does not match its saved attachment.");
  return image;
}
export async function commentImageAsset(collection: string, id: string) {
  const image = await readCommentImage(collection, id);
  return visualAsset(image.path, dataDirectory());
}
