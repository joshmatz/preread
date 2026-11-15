import { useEffect, useRef, useState } from "react";
import type { Collection, Review } from "./review-types";
import type { BriefCommand, BriefSnapshot } from "./brief-types";
import { briefScope } from "./brief-scope";

export type BriefState = ReturnType<typeof useBrief>;
// The page keeps one of these per brief it may show, so state is keyed by brief and a late reply for another brief is dropped.
export function useBrief(target: { collection: Collection; review?: Review } | null, refresh: number) {
  const key = target ? `${target.collection.id}/${target.review?.id ?? ""}` : "";
  const content = JSON.stringify(target?.review ? target.review.brief : target?.collection.brief);
  const scope = target ? briefScope(target.collection.id, target.review?.id) : null;
  const [state, setState] = useState<{ key: string; snapshot: BriefSnapshot | null }>({ key, snapshot: null });
  const [error, setError] = useState({ key, message: "" });
  const [saving, setSaving] = useState("");
  const [attempt, setAttempt] = useState(0);
  const versions = useRef(new Map<string, number>());
  const bumpVersion = (value: string) => versions.current.set(value, (versions.current.get(value) ?? 0) + 1);
  const active = useRef(key);
  active.current = key;
  useEffect(() => {
    if (!scope) return;
    const abort = new AbortController();
    const started = versions.current.get(key) ?? 0;
    setState((previous) => previous.key === key ? previous : { key, snapshot: null });
    fetch(`/api/brief?${new URLSearchParams(scope)}`, { signal: abort.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Could not load this brief.");
        if (!abort.signal.aborted && (versions.current.get(key) ?? 0) === started) { setState({ key, snapshot: value }); setError({ key, message: "" }); }
      }).catch((cause: Error) => { if (!abort.signal.aborted) setError({ key, message: cause.message }); });
    return () => abort.abort();
  }, [key, content, refresh, attempt]);
  async function save(command: BriefCommand) {
    if (!scope) return false;
    const current = key;
    bumpVersion(current);
    setSaving(current); setError({ key: current, message: "" });
    try {
      const response = await fetch("/api/brief-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, command }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not save your feedback.");
      bumpVersion(current);
      if (active.current === current) setState({ key: current, snapshot: value });
      return true;
    } catch (cause) {
      setError({ key: current, message: cause instanceof Error ? cause.message : "Could not save your feedback." });
      return false;
    } finally { setSaving((value) => value === current ? "" : value); }
  }
  return { snapshot: state.key === key ? state.snapshot : null, error: error.key === key ? error.message : "", saving: !!key && saving === key,
    save, retry: () => setAttempt((value) => value + 1) };
}
