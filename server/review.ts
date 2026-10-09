import { createHash } from "node:crypto";
import {
  comparison,
  comparisonSource,
  comparisonRefs,
  fileDiff,
  imagePreview,
  trackedPatches,
  MAX_PATCH,
} from "./git.ts";
import { readCollection, readReceipts, receiptKey, setReceipt } from "./collections.ts";
import { saveViewedFiles, withViewedBaselines, diffSinceViewed } from "./viewed-baselines.ts";
import { matchesRanges, parsePatch, patchFor, reviewContent } from "./patches.ts";
import type {
  ChangeGroup,
  FilePreview,
  Review,
  ReviewReceipt,
  ReviewSection,
  ReviewSnapshot,
} from "../src/review-types.ts";
import type { Mode } from "../src/types.ts";
import { reviewable } from "../src/change-notes.ts";

const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
// reviewContent drops index lines, which are all that identify a binary file's content.
const shown = (preview: FilePreview) =>
  preview.diff.binary ? preview.diff.patch : reviewContent(preview.diff.patch);
export function groupPreviews(
  files: FilePreview[],
  groups: ChangeGroup[],
  receipts: Record<string, ReviewReceipt>,
  review: Pick<Review, "id" | "path" | "base" | "mode">,
): ReviewSection[] {
  const assigned = new Map<string, Set<number>>();
  const sections: ReviewSection[] = [];
  const parsed = new Map(files.map((file) => [file.file.path, parsePatch(file.diff.patch)]));
  const views = new Map<string, number>();
  const finish = (
    group: ChangeGroup,
    previews: FilePreview[],
    warnings: string[],
  ): ReviewSection => {
    const fingerprint = hash({
      scope: [review.path, review.base, review.mode],
      title: group.title,
      description: group.description,
      targets: group.targets,
      files: previews.map((preview) => [
        preview.file.path,
        preview.file.oldPath,
        preview.file.status,
        shown(preview),
        preview.diff.binary,
        preview.diff.tooLarge,
        preview.error,
      ]),
    });
    const receipt = receipts[receiptKey(review.id, group.id)];
    return {
      id: group.id,
      title: group.title,
      description: group.description,
      ...(group.visuals?.length ? { visuals: group.visuals } : {}),
      // Viewed marks follow what was shown, so edits to other blocks of a file leave them alone.
      // Identical blocks of one file are numbered so each keeps its own mark.
      files: previews.map((preview) => {
        const viewHash = hash(shown(preview));
        const id = `${preview.file.path}|${viewHash}`;
        const repeat = views.get(id) ?? 0;
        views.set(id, repeat + 1);
        return { ...preview, viewHash: repeat ? hash([viewHash, repeat]) : viewHash };
      }),
      fingerprint,
      reviewed: receipt?.fingerprint === fingerprint,
      reviewedAt: receipt?.reviewedAt,
      changedSinceReview: !!receipt && receipt.fingerprint !== fingerprint,
      canReview:
        previews.length > 0 &&
        !warnings.length &&
        previews.every(reviewable),
      warnings,
    };
  };
  for (const group of groups) {
    const previews: FilePreview[] = [];
    const warnings: string[] = [];
    const selected = new Map<string, Set<number>>();
    for (const target of group.targets) {
      const preview = files.find((file) => file.file.path === target.path);
      if (!preview) {
        warnings.push(
          `“${target.path}” is no longer in this comparison. Update the group before reviewing it.`,
        );
      } else {
        const { hunks } = parsed.get(target.path)!;
        const indices = hunks.length
          ? hunks
              .map((_, index) => index)
              .filter((index) => !target.ranges || matchesRanges(hunks[index], target.ranges))
          : target.ranges
            ? []
            : [-1];
        if (!indices.length)
          warnings.push(
            `The selected lines in “${target.path}” no longer match a change. Update the group’s line ranges.`,
          );
        const entries = selected.get(target.path) ?? new Set<number>();
        for (const index of indices) entries.add(index);
        selected.set(target.path, entries);
      }
    }
    for (const [path, indices] of selected) {
      if (indices.size) {
        const preview = files.find((file) => file.file.path === path)!;
        const { header, hunks } = parsed.get(path)!;
        const used = assigned.get(path) ?? new Set<number>();
        const overlapping = [...indices].some((index) => used.has(index));
        if (overlapping)
          warnings.push(
            `Some changes in “${path}” also belong to an earlier group. Review status is separate for each group.`,
          );
        for (const index of indices) used.add(index);
        assigned.set(path, used);
        const partial = hunks.length > indices.size;
        const patch = hunks.length
          ? patchFor(
              header,
              hunks.filter((_, index) => indices.has(index)),
            )
          : preview.diff.patch;
        previews.push({
          ...preview,
          contextHash: preview.diff.hash,
          partial,
          diff: { ...preview.diff, patch, hash: hash(patch) },
        });
      }
    }
    sections.push(finish(group, previews, warnings));
  }
  const remainder = files.flatMap((preview) => {
    const { header, hunks } = parsed.get(preview.file.path)!;
    const used = assigned.get(preview.file.path) ?? new Set<number>();
    if (!hunks.length) return used.has(-1) ? [] : [preview];
    const remaining = hunks.filter((_, index) => !used.has(index));
    if (!remaining.length) return [];
    const patch = patchFor(header, remaining);
    return [
      {
        ...preview,
        contextHash: preview.diff.hash,
        partial: remaining.length < hunks.length,
        diff: { ...preview.diff, patch, hash: hash(patch) },
      },
    ];
  });
  if (remainder.length || !groups.length)
    sections.push(
      finish(
        {
          id: "other-changes",
          title: groups.length ? "Other changes" : "All changes",
          description: groups.length ? "Changes that haven’t been assigned to a group." : "",
          targets: [],
        },
        remainder,
        [],
      ),
    );
  return sections;
}
export async function resolveReview(collectionId: string, reviewId: string) {
  const collection = await readCollection(collectionId);
  const review = collection.reviews.find((entry) => entry.id === reviewId);
  if (!review) throw new Error("That review is not in this collection.");
  return review;
}
type ReviewData = { comparison: ReviewSnapshot["comparison"]; files: FilePreview[] };
const branchCache = new Map<string, { promise: Promise<ReviewData>; bytes: number }>();
function trimCache() {
  let bytes = [...branchCache.values()].reduce((total, entry) => total + entry.bytes, 0);
  for (const [key, entry] of branchCache) {
    if (branchCache.size <= 16 && bytes <= 64 * 1024 * 1024) break;
    branchCache.delete(key);
    bytes -= entry.bytes;
  }
}
async function readReviewData(
  review: Review,
  source: Awaited<ReturnType<typeof comparisonSource>>,
): Promise<ReviewData> {
  const path = source.path;
  const info = await comparison(path, review.base, review.mode, source);
  const files: FilePreview[] = [];
  // When the combined read fails, each file falls back to the bounded per-file reader.
  // Git output and retained patches are bounded by bytes, not the number of files.
  const patches = await trackedPatches(path, info, review.mode).catch(() => null);
  let bytes = 0;
  for (let offset = 0; offset < info.files.length; offset += 4) {
    const batch = await Promise.all(
      info.files.slice(offset, offset + 4).map(async (file): Promise<FilePreview> => {
        if (bytes > 24 * 1024 * 1024)
          return {
            file,
            partial: false,
            diff: { patch: "", hash: "", binary: file.binary, tooLarge: true, empty: false },
            error: "This file was not loaded because the comparison reached its 24 MB preview limit.",
          };
        try {
          const patch = patches?.get(file.path);
          if (!file.untracked && patch !== undefined) {
            const tooLarge = Buffer.byteLength(patch) > MAX_PATCH;
            return {
              file,
              partial: false,
              diff: {
                patch: tooLarge ? "" : patch,
                hash: createHash("sha256").update(patch).digest("hex"),
                binary: file.binary,
                tooLarge,
                empty: !patch && !file.binary && !tooLarge,
              },
            };
          }
          return {
            file,
            partial: false,
            diff: await fileDiff(path, review.base, review.mode, file.path, info),
          };
        } catch (error) {
          return {
            file,
            partial: false,
            diff: { patch: "", hash: "", binary: file.binary, tooLarge: false, empty: true },
            error: (error as Error).message,
          };
        }
      }),
    );
    await Promise.all(
      batch.map(async (preview) => {
        if (!preview.diff.binary || preview.error) return;
        const image = await imagePreview(path, info, review.mode, preview.file);
        if (image) preview.diff.image = image;
      }),
    );
    files.push(...batch);
    bytes += batch.reduce((total, preview) => total + Buffer.byteLength(preview.diff.patch), 0);
  }
  // Branch reads use pinned commit IDs throughout; only mutable comparisons need a second scan.
  if (review.mode !== "branch") {
    const after = await comparison(path, review.base, review.mode);
    if (info.version !== after.version)
      throw new Error(
        "The worktree changed while loading this review. Refresh to see its current changes.",
      );
  }
  return { comparison: info, files };
}
const baselineReview = (review: Review, collectionId?: string): Review =>
  ({ ...review, id: collectionId ? `${collectionId}/${review.id}` : review.id });
export async function snapshot(review: Review, collectionId?: string): Promise<ReviewSnapshot> {
  const refs = await comparisonRefs(review.path, review.base, review.mode);
  const read = async () =>
    readReviewData(review, await comparisonSource(review.path, review.base, review.mode, refs));
  let data: ReviewData;
  if (review.mode === "branch") {
    // Only immutable Git content is shared, never review receipts.
    const key = JSON.stringify([refs.path, review.base, refs.head, refs.baseSha]);
    let entry = branchCache.get(key);
    if (entry) {
      branchCache.delete(key);
      branchCache.set(key, entry);
    } else {
      entry = { promise: read(), bytes: 0 };
      branchCache.set(key, entry);
      trimCache();
    }
    try {
      data = await entry.promise;
      entry.bytes = data.files.reduce(
        (total, file) => total + Buffer.byteLength(file.diff.patch),
        0,
      );
      if (data.files.some((file) => file.error)) branchCache.delete(key);
      trimCache();
    } catch (error) {
      branchCache.delete(key);
      throw error;
    }
  } else data = await read();
  const receipts = collectionId ? await readReceipts(collectionId) : {};
  return {
    comparison: data.comparison,
    sections: await withViewedBaselines(baselineReview(review, collectionId), groupPreviews(data.files, review.groups, receipts, review)),
  };
}
export const adHocReview = (path: string, base: string, mode: Mode): Review => ({
  id: "local",
  title: "Local changes",
  description: "",
  path,
  base,
  mode,
  groups: [],
});
export async function markGroup(
  collectionId: string,
  reviewId: string,
  groupId: string,
  fingerprint: string,
  reviewed: boolean,
) {
  const review = await resolveReview(collectionId, reviewId);
  const current = await snapshot(review, collectionId);
  const section = current.sections.find((section) => section.id === groupId);
  if (!section || section.fingerprint !== fingerprint)
    throw new Error(
      "These changes or their description have changed. Refresh before marking the group reviewed.",
    );
  if (reviewed && !section.canReview)
    throw new Error(
      "This group has unavailable or unmatched changes. Resolve those before marking it reviewed.",
    );
  if (reviewed) await saveViewedFiles(baselineReview(review, collectionId), groupId, section.files, current.comparison);
  await setReceipt(collectionId, reviewId, groupId, reviewed ? fingerprint : null);
  const receipt = await readReceipts(collectionId);
  const saved = receipt[receiptKey(reviewId, groupId)];
  return {
    ...current,
    sections: await withViewedBaselines(baselineReview(review, collectionId), current.sections.map((section) =>
      section.id === groupId
        ? {
            ...section,
            reviewed: !!saved,
            reviewedAt: saved?.reviewedAt,
            changedSinceReview: false,
          }
        : section,
    )),
  };
}


export async function viewedFile(review: Review, group: string, name: string,
  expectedHash: string, expectedViewHash: string, save: boolean, collectionId?: string) {
  const info = await comparison(review.path, review.base, review.mode);
  const file = info.files.find((entry) => entry.path === name);
  if (!file) throw new Error("This file is not part of the current comparison. Refresh the review.");
  const diff = await fileDiff(review.path, review.base, review.mode, name, info);
  if (diff.hash !== expectedHash) throw new Error("This file changed since the review loaded. Refresh the review.");
  const section = groupPreviews([{ file, diff, partial: false }], review.groups, {}, review)
    .find((entry) => entry.id === group);
  const preview = section?.files.find((entry) => entry.file.path === name);
  if (!preview || preview.viewHash !== expectedViewHash)
    throw new Error("The selected blocks changed since the review loaded. Refresh the review.");
  return save
    ? (await saveViewedFiles(baselineReview(review, collectionId), group, [preview], info))[0]
    : diffSinceViewed(baselineReview(review, collectionId), group, preview, info);
}
