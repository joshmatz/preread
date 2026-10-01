import { useEffect, useRef, useState } from "react";
import type { Collection, ProgressDetails, ReviewProgress, ReviewSnapshot } from "./review-types";
import { fileViewed, useFileStateVersion } from "./useFileState";
import { progressFromSource, progressSource, reviewProgress } from "./progress";

export function useCollectionProgress(
  collection: Collection | undefined,
  refresh: number,
  selectedId: string,
  snapshot: ReviewSnapshot | null,
) {
  useFileStateVersion();
  const [results, setResults] = useState<{
    collection: string;
    items: Record<string, ProgressDetails>;
  }>({ collection: "", items: {} });
  const versions = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!collection) return;
    const abort = new AbortController();
    setResults({ collection: collection.id, items: {} });
    let index = 0;
    const update = (id: string, progress: ProgressDetails) => {
      if (!abort.signal.aborted)
        setResults((previous) =>
          previous.collection === collection.id
            ? { ...previous, items: { ...previous.items, [id]: progress } }
            : previous,
        );
    };
    const worker = async () => {
      while (index < collection.reviews.length && !abort.signal.aborted) {
        const review = collection.reviews[index];
        index += 1;
        const version = versions.current[review.id] ?? 0;
        try {
          const response = await fetch(
            `/api/review-progress?${new URLSearchParams({ collection: collection.id, review: review.id })}`,
            { signal: abort.signal },
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not check this review.");
          if (version === (versions.current[review.id] ?? 0)) update(review.id, data);
        } catch (cause) {
          if (!abort.signal.aborted && version === (versions.current[review.id] ?? 0))
            update(review.id, {
              status: "unavailable",
              reviewedGroups: 0,
              totalGroups: 0,
              changedGroups: 0,
              attentionGroups: 0,
              error: (cause as Error).message,
            });
        }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => abort.abort();
  }, [JSON.stringify(collection), refresh]);
  useEffect(() => {
    if (!collection || !snapshot || !selectedId) return;
    // A slower background check must not overwrite a newly saved review receipt.
    versions.current[selectedId] = (versions.current[selectedId] ?? 0) + 1;
    setResults((previous) => ({
      collection: collection.id,
      items: {
        ...(previous.collection === collection.id ? previous.items : {}),
        [selectedId]: { ...reviewProgress(snapshot), source: progressSource(snapshot) },
      },
    }));
  }, [selectedId, snapshot]);
  const items: Record<string, ReviewProgress> = {};
  if (collection && results.collection === collection.id) {
    for (const review of collection.reviews) {
      const entry = results.items[review.id];
      if (entry) {
        items[review.id] = entry.source
          ? progressFromSource(entry.source, (path, hash, fallback) =>
              fileViewed(review.path, path, hash, fallback),
            )
          : entry;
      }
    }
  }
  return items;
}
