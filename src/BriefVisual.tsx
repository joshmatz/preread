import React, { useEffect, useState } from "react";
import type { ReviewVisual } from "./review-types";
import { BriefDialog } from "./BriefDialog";
import { briefScope } from "./brief-scope";

export function BriefVisual({ collection, review, block, visual }: { collection: string; review?: string; block: string; visual: ReviewVisual }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); let objectUrl = "";
    setSource(""); setError("");
    const url = `/api/brief-visual?${new URLSearchParams({ ...briefScope(collection, review), block })}`;
    const load = async () => {
      try {
        if (!/\.(mmd|mermaid)$/i.test(visual.path)) { setSource(url); return; }
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error("Could not load this diagram.");
        const { mermaidVisual } = await import("./mermaid-visual");
        objectUrl = await mermaidVisual(await response.text());
        if (!abort.signal.aborted) setSource(objectUrl); else URL.revokeObjectURL(objectUrl);
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load this visual."); }
    };
    void load();
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [collection, review, block, visual.path, attempt]);
  return <figure className="brief-visual">
    <div className="brief-visual-heading"><span>{visual.title}</span><button onClick={() => setOpen(true)} disabled={!source || !!error}>Expand image ↗</button></div>
    {error ? <div className="brief-visual-error" role="alert">{error}<button onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>
      : source ? <button className="brief-image" aria-label={`Expand ${visual.title}`} onClick={() => setOpen(true)}>
        <img src={source} alt={visual.title} loading="lazy" onError={() => setError("Could not load this visual. Your brief is still available.")} /></button>
        : <p className="muted" role="status">Loading diagram…</p>}
    {visual.caption && <figcaption data-brief-text={block}>{visual.caption}</figcaption>}
    {open && <BriefDialog title={visual.title} wide onClose={() => setOpen(false)}><img className="brief-expanded-image" src={source} alt={visual.title} /></BriefDialog>}
  </figure>;
}
