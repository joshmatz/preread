import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import { dataDirectory } from "./collections.ts";
import { fileDiff, viewedFileText, MAX_PATCH } from "./git.ts";
import type { Comparison, Diff } from "../src/types.ts";
import type { FilePreview, Review, ReviewSection, ViewedBaselineInfo, SinceViewed } from "../src/review-types.ts";

interface Baseline extends ViewedBaselineInfo {
  content?: string;
}
const key = (review: Review, group: string, file: string) => createHash("sha256")
  .update(JSON.stringify([review.path, review.base, review.mode, review.id, group, file])).digest("hex");
const location = (review: Review, group: string, file: string) =>
  join(dataDirectory(), "viewed", `${key(review, group, file)}.json`);
const info = ({ viewHash, reviewedAt, hasText }: Baseline): ViewedBaselineInfo =>
  ({ viewHash, reviewedAt, hasText });
async function readBaseline(review: Review, group: string, file: string): Promise<Baseline | null> {
  try {
    return JSON.parse(await readFile(location(review, group, file), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function textAtView(review: Review, preview: FilePreview, comparison: Comparison) {
  if (preview.diff.binary || preview.diff.tooLarge || preview.error) return undefined;
  return viewedFileText(review.path, review.base, review.mode, preview.file, comparison,
    preview.contextHash ?? preview.diff.hash);
}
let writes: Promise<unknown> = Promise.resolve();
export function saveViewedFiles(review: Review, group: string, previews: FilePreview[], comparison: Comparison) {
  const operation = writes.then(async () => {
    const baselines: Baseline[] = [];
    const reviewedAt = new Date().toISOString();
    // Finish all reads before writing any baseline, so stale bulk clicks do not
    // move part of a group's baseline forward.
    for (let offset = 0; offset < previews.length; offset += 4) {
      baselines.push(...await Promise.all(previews.slice(offset, offset + 4).map(async (preview) => {
        const content = await textAtView(review, preview, comparison);
        return { viewHash: preview.viewHash ?? preview.diff.hash, reviewedAt,
          hasText: content !== undefined, ...(content !== undefined ? { content } : {}) };
      })));
    }
    // A file read early in a bulk click must still match when the group is saved.
    for (let offset = 0; offset < previews.length; offset += 4) {
      await Promise.all(previews.slice(offset, offset + 4).map(async (preview) => {
        const current = await fileDiff(review.path, review.base, review.mode, preview.file.path, comparison);
        if (current.hash !== (preview.contextHash ?? preview.diff.hash))
          throw new Error("These files changed while saving viewed versions. Refresh and review them again.");
      }));
    }
    await mkdir(join(dataDirectory(), "viewed"), { recursive: true, mode: 0o700 });
    for (let index = 0; index < previews.length; index++) {
      const path = location(review, group, previews[index].file.path);
      const temp = `${path}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(baselines[index]), { mode: 0o600 });
      await rename(temp, path);
    }
    return baselines.map(info);
  });
  writes = operation.catch(() => {});
  return operation;
}
export async function withViewedBaselines(review: Review, sections: ReviewSection[]) {
  const result: ReviewSection[] = [];
  for (const section of sections) {
    const files: FilePreview[] = [];
    for (let offset = 0; offset < section.files.length; offset += 4) {
      files.push(...await Promise.all(section.files.slice(offset, offset + 4).map(async (preview) => {
        const baseline = await readBaseline(review, section.id, preview.file.path);
        return baseline ? { ...preview, lastViewed: info(baseline) } : preview;
      })));
    }
    result.push({ ...section, files, changedSinceReview: section.changedSinceReview || files.some(
      (preview) => preview.lastViewed && preview.lastViewed.viewHash !== preview.viewHash,
    ) });
  }
  return result;
}
export async function diffSinceViewed(review: Review, group: string, preview: FilePreview,
  comparison: Comparison): Promise<SinceViewed> {
  const baseline = await readBaseline(review, group, preview.file.path);
  if (!baseline) return { available: false,
    message: "No viewed version was saved for this file. Mark it viewed to save a baseline for future changes." };
  const content = await textAtView(review, preview, comparison);
  if (baseline.content === undefined || content === undefined) return { available: false,
    reviewedAt: baseline.reviewedAt, message: "A text comparison is unavailable for this file. Use the full review to inspect it." };
  const patch = baseline.content === content ? "" : createTwoFilesPatch(
    `a/${preview.file.path}`, `b/${preview.file.path}`, baseline.content, content,
    "Last viewed", "Current", { context: 3, timeout: 1000 });
  if (patch === undefined) return { available: false, reviewedAt: baseline.reviewedAt,
    message: "This comparison took too long to compute. Use the full review to inspect it." };
  const tooLarge = Buffer.byteLength(patch) > MAX_PATCH;
  const diff: Diff = { patch: tooLarge ? "" : patch, binary: false, tooLarge,
    empty: !patch, hash: createHash("sha256").update(patch).digest("hex") };
  return { available: true, reviewedAt: baseline.reviewedAt, diff };
}
