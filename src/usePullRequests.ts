import { useEffect, useState } from "react";
import type { Collection } from "./review-types";
import type { PullRequestResult } from "./pull-requests";

export interface PullRequestEntry {
  result?: PullRequestResult;
  loading: boolean;
}
export function usePullRequests(collection: Collection | undefined, refresh: number) {
  const [entries, setEntries] = useState<Record<string, PullRequestEntry>>({});
  const read = async (
    collectionId: string,
    review: { id: string; pullRequest?: string },
    force: boolean,
    signal?: AbortSignal,
  ) => {
    const url = review.pullRequest;
    if (!url) return;
    setEntries((previous) => ({ ...previous, [url]: { ...previous[url], loading: true } }));
    let result: PullRequestResult;
    try {
      const response = await fetch(
        `/api/pull-request?${new URLSearchParams({ collection: collectionId, review: review.id, refresh: force ? "1" : "0" })}`,
        { signal },
      );
      const data = await response.json();
      if (!response.ok || !data) throw new Error(data?.error || "PR link is unavailable.");
      result = data;
    } catch (cause) {
      if (signal?.aborted) return;
      result = { url, error: (cause as Error).message };
    }
    if (!signal?.aborted)
      setEntries((previous) => ({
        ...previous,
        [url]: {
          result: {
            ...result,
            status: result.status ?? (result.error ? previous[url]?.result?.status : undefined),
          },
          loading: false,
        },
      }));
  };
  useEffect(() => {
    if (!collection) return;
    const abort = new AbortController();
    const reviews = collection.reviews.filter((review) => review.pullRequest);
    let index = 0;
    const worker = async () => {
      while (index < reviews.length && !abort.signal.aborted) {
        const review = reviews[index];
        index += 1;
        await read(collection.id, review, false, abort.signal);
      }
    };
    void Promise.all([worker(), worker()]);
    return () => abort.abort();
  }, [JSON.stringify(collection), refresh]);
  return {
    entries,
    refreshPullRequest: (reviewId: string) => {
      const review = collection?.reviews.find((item) => item.id === reviewId);
      if (collection && review) void read(collection.id, review, true);
    },
  };
}
