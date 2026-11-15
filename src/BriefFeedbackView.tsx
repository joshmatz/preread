import React, { useState } from "react";
import { ArrowRight, Copy, MessageSquare } from "lucide-react";
import type { BriefFeedback, BriefSnapshot } from "./brief-types";
import { anchorQuote, exportBriefFeedback, feedbackBody, feedbackCurrent, feedbackTitle } from "./brief-feedback";
import { BriefDialog } from "./BriefDialog";
import { CommentImages, savedCommentImages } from "./CommentImages";

type Part = { id: string; title: string; count: number };
type Prepared = { state: "loading" } | { state: "ready"; text: string } | { state: "error"; message: string };

export function BriefFeedbackView({ collection, title, review, snapshot, saving, parts = [], onEdit, onDelete, onLocate, onComment, onPart }: {
  collection: string; title: string; review?: { id: string; title: string }; snapshot: BriefSnapshot; saving: boolean; parts?: Part[];
  onEdit: (entry: Extract<BriefFeedback, { kind: "comment" }>) => void;
  onDelete: (id: string) => void; onLocate: (entry: BriefFeedback) => void; onComment: () => void; onPart?: (id: string) => void;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [copied, setCopied] = useState(false);
  const partEntries = parts.reduce((sum, part) => sum + part.count, 0);
  const whole = !review && partEntries > 0;
  const prepare = async () => {
    setCopied(false);
    if (!whole) { setPrepared({ state: "ready", text: exportBriefFeedback(title, snapshot, review?.title) }); return; }
    setPrepared({ state: "loading" });
    try {
      const response = await fetch(`/api/brief-export?${new URLSearchParams({ collection })}`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not prepare the feedback.");
      setPrepared({ state: "ready", text: value.text });
    } catch (cause) { setPrepared({ state: "error", message: cause instanceof Error ? cause.message : "Could not prepare the feedback." }); }
  };
  return <section className="brief-feedback-view">
    <h2>Everything you’re handing back</h2><p className="brief-introduction">Answers, approvals, and comments include their place in the {review ? "part" : "feature"} and the content you read.</p>
    {!snapshot.feedback.length ? <div className="brief-empty"><h3>No feedback {whole ? "on the overview" : "yet"}</h3><p>Answer a question, approve an excerpt, or select a passage and leave a comment.</p></div>
      : <div className="brief-feedback-list">{snapshot.feedback.map((entry) => <section className="brief-feedback-item" key={entry.id}>
        <div className="brief-feedback-kind">{entry.kind === "answer" ? "Question answered" : entry.kind === "approval" ? "Code approval" : "Comment"}{!feedbackCurrent(entry, snapshot) && <span className="brief-earlier">Earlier revision</span>}</div>
        <h3>{feedbackTitle(entry)}</h3>
        {entry.kind === "comment" && anchorQuote(entry.anchor) && <blockquote className="brief-quote">{anchorQuote(entry.anchor)}</blockquote>}
        <p>{feedbackBody(entry)}</p>
        {entry.kind === "comment" && <CommentImages images={savedCommentImages(collection, entry.id, entry.attachments, review?.id)} />}
        {entry.kind === "approval" && <details><summary>Approved excerpt</summary><pre><code>{entry.block.code}</code></pre></details>}
        <div className="brief-feedback-actions">{entry.kind === "comment" && <button onClick={() => onEdit(entry)}>Edit comment</button>}
          {entry.kind === "comment" && entry.anchor.kind !== "document" && feedbackCurrent(entry, snapshot) && <button onClick={() => onLocate(entry)}>Show in overview</button>}
          <button disabled={saving} onClick={() => onDelete(entry.id)}>Remove</button></div>
      </section>)}</div>}
    {parts.length > 0 && <section className="brief-feedback-parts"><h3>Feedback in parts</h3>
      <ul>{parts.map((part) => <li key={part.id}><button onClick={() => onPart?.(part.id)}><span>{part.title}</span><span className="pill">{part.count}</span><ArrowRight size={13} /></button></li>)}</ul>
    </section>}
    <div className="brief-handoff-actions">{(!!snapshot.feedback.length || whole) && <button className="primary" onClick={prepare}>
      {whole ? `Prepare all feedback · ${snapshot.feedback.length + partEntries}` : "Prepare feedback"} <ArrowRight size={15} /></button>}
      <button className="brief-secondary" onClick={onComment}><MessageSquare size={14} /> Add a comment</button></div>
    {prepared && <BriefDialog title="Feedback, ready to hand off" onClose={() => setPrepared(null)}>
      <p className="brief-dialog-intro">{whole ? "One batch with the feature overview and every part, with answers, approved code, and quoted passages." : "One batch with answers, approved code, and quoted passages."} Nothing is sent automatically.</p>
      {prepared.state === "loading" ? <p className="muted" role="status">Collecting feedback from every part…</p>
        : prepared.state === "error" ? <p className="brief-error" role="alert">{prepared.message}</p>
        : <><label className="brief-field-label" htmlFor="brief-export">Prepared feedback</label><textarea id="brief-export" className="brief-export" readOnly value={prepared.text} />
          <div className="brief-dialog-actions"><span role="status">{copied ? "Copied. Nothing has been sent." : "Copy this into the conversation where work continues."}</span><button className="primary" onClick={async () => {
            try { await navigator.clipboard.writeText(prepared.text); setCopied(true); }
            catch { const field = document.getElementById("brief-export"); if (field instanceof HTMLTextAreaElement) { field.focus(); field.select(); } }
          }}><Copy size={14} /> Copy feedback</button></div></>}
    </BriefDialog>}
  </section>;
}
