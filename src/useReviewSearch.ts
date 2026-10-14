import { useEffect, useRef, useState } from "react";
import type { SearchDocument, SearchResult, SearchScope } from "./review-search";

export function useReviewSearch(documents: SearchDocument[], query: string, scope: SearchScope) {
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const requestedKey = `${scope}:${query}`;
  const latestKey = useRef(requestedKey);
  latestKey.current = requestedKey;
  const [state, setState] = useState<{ id: number; results: SearchResult[]; key?: string; error?: string }>({ id: 0, results: [] });
  useEffect(() => {
    const current = new Worker(new URL("./review-search.worker.ts", import.meta.url), { type: "module" });
    worker.current = current;
    current.onmessage = (event: MessageEvent<{ id: number; results: SearchResult[] }>) => {
      if (event.data.id === sequence.current) setState({ ...event.data, key: latestKey.current });
    };
    current.onerror = () => setState({ id: sequence.current, results: [], key: latestKey.current, error: "Search could not start. Refresh to retry." });
    return () => { current.terminate(); worker.current = null; };
  }, []);
  useEffect(() => { worker.current?.postMessage({ documents }); }, [documents]);
  useEffect(() => {
    const id = ++sequence.current;
    if (!query.trim()) { setState({ id, results: [] }); return; }
    const timer = setTimeout(() => worker.current?.postMessage({ query, scope, id }), 100);
    return () => clearTimeout(timer);
  }, [documents, query, scope]);
  return { results: state.results, pending: !!query.trim() && state.key !== requestedKey, error: state.error };
}
