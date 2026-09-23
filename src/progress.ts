import type { ProgressSource, ReviewProgress, ReviewSnapshot } from "./review-types";

export type ViewedReader = (path: string, hash: string, fallback: boolean) => boolean;
export function progressSource(snapshot: ReviewSnapshot): ProgressSource {
  return {
    empty:
      !snapshot.comparison.files.length &&
      snapshot.sections.every((section) => !section.warnings.length),
    sections: snapshot.sections.map((section) => ({
      reviewed: section.reviewed,
      canReview: section.canReview,
      changedSinceReview: section.changedSinceReview,
      files: section.files.map((preview) => ({ path: preview.file.path, hash: preview.diff.hash })),
    })),
  };
}

export function sectionViewed(section: ProgressSource["sections"][number], viewed?: ViewedReader) {
  return (
    section.canReview &&
    section.files.length > 0 &&
    (viewed
      ? section.files.every((file) => viewed(file.path, file.hash, section.reviewed))
      : section.reviewed)
  );
}

export function withFileViews(snapshot: ReviewSnapshot, viewed: ViewedReader): ReviewSnapshot {
  const source = progressSource(snapshot);
  return {
    ...snapshot,
    sections: snapshot.sections.map((section, index) => {
      const reviewed = sectionViewed(source.sections[index], viewed);
      return { ...section, reviewed, changedSinceReview: !reviewed && section.changedSinceReview };
    }),
  };
}

export function reviewProgress(snapshot: ReviewSnapshot): ReviewProgress {
  return progressFromSource(progressSource(snapshot));
}
export function progressFromSource(source: ProgressSource, viewed?: ViewedReader): ReviewProgress {
  const { sections, empty } = source;
  const totalGroups = empty ? 0 : sections.length;
  const reviewedGroups = sections.filter((section) => sectionViewed(section, viewed)).length;
  const changedGroups = sections.filter(
    (section) => section.changedSinceReview && !sectionViewed(section, viewed),
  ).length;
  const attentionGroups = empty ? 0 : sections.filter((section) => !section.canReview).length;
  let status: ReviewProgress["status"] = "unreviewed";
  if (empty) status = "empty";
  else if (attentionGroups) status = "attention";
  else if (changedGroups) status = "changed";
  else if (totalGroups > 0 && reviewedGroups === totalGroups) status = "reviewed";
  else if (reviewedGroups) status = "partial";
  return { status, reviewedGroups, totalGroups, changedGroups, attentionGroups };
}
export function collectionProgress(items: Array<ReviewProgress | undefined>) {
  const reviewedItems = items.filter((item) => item?.status === "reviewed").length;
  const emptyItems = items.filter((item) => item?.status === "empty").length;
  const checkingItems = items.filter((item) => !item).length;
  return {
    totalItems: items.length,
    reviewedItems,
    emptyItems,
    checkingItems,
    complete: items.length > 0 && reviewedItems + emptyItems === items.length,
    reviewedGroups: items.reduce((sum, item) => sum + (item?.reviewedGroups ?? 0), 0),
    totalGroups: items.reduce((sum, item) => sum + (item?.totalGroups ?? 0), 0),
  };
}
export function progressLabel(progress?: ReviewProgress): string {
  if (!progress) return "Checking…";
  if (progress.status === "empty") return "No changes";
  if (progress.status === "unavailable") return "Couldn’t check";
  const count = `${progress.reviewedGroups}/${progress.totalGroups} groups reviewed`;
  if (progress.status === "reviewed") return `Reviewed · ${count}`;
  if (progress.status === "changed") return `${count} · changed since review`;
  if (progress.status === "attention") return `${count} · needs attention`;
  return count;
}
