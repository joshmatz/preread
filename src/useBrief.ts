import { useEffect, useRef, useState } from "react";
import type { Collection, Review } from "./review-types";
import type { BriefAttention, BriefCommand, BriefSnapshot } from "./brief-types";
import { briefScope } from "./brief-scope";
import { noThreads } from "./threads";

// Between a build and the server's restart, the old server serves this bundle snapshots without thread fields.
function normalize(value: BriefSnapshot): BriefSnapshot {
  const counted = (entry: BriefAttention) => ({ ...entry, threads: entry.threads ?? noThreads() });
  return { ...value, threads: value.threads ?? {}, attention: value.attention && { ...value.attention,
    feature: value.attention.feature && counted(value.attention.feature),
    reviews: Object.fromEntries(Object.entries(value.attention.reviews ?? {}).map(([id, entry]) => [id, counted(entry)])) } };
}

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
        if (!abort.signal.aborted && (versions.current.get(key) ?? 0) === started) { setState({ key, snapshot: normalize(value) }); setError({ key, message: "" }); }
      }).catch((cause: Error) => { if (!abort.signal.aborted) setError({ key, message: cause.message }); });
    return () => abort.abort();
  }, [key, content, refresh, attempt]);
  // `quiet` leaves the brief's own error alone, for a caller that shows the error beside what failed.
  async function run(command: BriefCommand, quiet: boolean): Promise<{ error?: string }> {
    if (!scope) return { error: "This brief is not loaded." };
    const current = key;
    bumpVersion(current);
    setSaving(current);
    if (!quiet) setError({ key: current, message: "" });
    try {
      const response = await fetch("/api/brief-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, command }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not save your feedback.");
      bumpVersion(current);
      if (active.current === current) setState({ key: current, snapshot: normalize(value) });
      return {};
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save your feedback.";
      if (!quiet) setError({ key: current, message });
      return { error: message };
    } finally { setSaving((value) => value === current ? "" : value); }
  }
  return { snapshot: state.key === key ? state.snapshot : null, error: error.key === key ? error.message : "", saving: !!key && saving === key,
    save: async (command: BriefCommand) => !(await run(command, false)).error, send: (command: BriefCommand) => run(command, true),
    retry: () => setAttempt((value) => value + 1) };
}
