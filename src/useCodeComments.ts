import { useEffect, useRef, useState } from "react";
import type { CodeComment, CodeCommentCommand } from "./code-comments";

export type CodeComments = ReturnType<typeof useCodeComments>;
const none: CodeComment[] = [];
// A page built after its server started can call routes that server doesn't have yet.
const failure = (response: Response, value: { error?: string }, fallback: string) =>
  response.status === 404 ? "Preread’s server is older than this page. Restart it, then try again." : value.error || fallback;
// Keyed by review, so a late reply for the review the reader just left is dropped.
export function useCodeComments(collection: string, review: string, refresh: number) {
  const key = collection && review ? `${collection}/${review}` : "";
  const [state, setState] = useState<{ key: string; comments: CodeComment[] | null }>({ key, comments: null });
  const [error, setError] = useState({ key, message: "" });
  const [saving, setSaving] = useState(false);
  const versions = useRef(new Map<string, number>());
  const bumpVersion = (value: string) => versions.current.set(value, (versions.current.get(value) ?? 0) + 1);
  const active = useRef(key);
  active.current = key;
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    const started = versions.current.get(key) ?? 0;
    fetch(`/api/code-comments?${new URLSearchParams({ collection, review })}`, { signal: abort.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(failure(response, value, "Could not load comments."));
        if (!abort.signal.aborted && (versions.current.get(key) ?? 0) === started) { setState({ key, comments: value.comments }); setError({ key, message: "" }); }
      }).catch((cause: Error) => { if (!abort.signal.aborted) setError({ key, message: cause.message }); });
    return () => abort.abort();
  }, [key, refresh]);
  async function save(command: CodeCommentCommand): Promise<{ error?: string }> {
    if (!key) return { error: "Comments need a review in a collection." };
    const current = key;
    bumpVersion(current);
    setSaving(true); setError({ key: current, message: "" });
    try {
      const response = await fetch("/api/code-comments", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection, review, command }) });
      const value = await response.json();
      if (!response.ok) throw new Error(failure(response, value, "Could not save your comment."));
      bumpVersion(current);
      if (active.current === current) setState({ key: current, comments: value.comments });
      return {};
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save your comment.";
      setError({ key: current, message });
      return { error: message };
    } finally { setSaving(false); }
  }
  return { enabled: !!key, comments: state.key === key ? state.comments ?? none : none, loaded: state.key === key && !!state.comments,
    error: error.key === key ? error.message : "", saving, save };
}
