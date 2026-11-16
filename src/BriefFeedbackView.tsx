import React, { useState } from "react";
import { ArrowRight, Copy, MessageSquare } from "lucide-react";
import type { BriefFeedback, BriefSnapshot } from "./brief-types";
import { anchorQuote, exportBriefFeedback, feedbackBody, feedbackCurrent, feedbackTitle } from "./brief-feedback";
import { codeCommentPlace, lineText, sortCodeComments, type CodeComment } from "./code-comments";
import { useRemoval } from "./CodeComments";
import { BriefDialog } from "./BriefDialog";
import { CommentImages, savedCommentImages } from "./CommentImages";

type Part = { id: string; title: string; count: number };
type Prepared = { state: "loading" } | { state: "ready"; text: string } | { state: "error"; message: string };
export type CodeFeedback = {
  comments: CodeComment[]; loaded: boolean; saving: boolean; error: string; groupTitle: (group: string) => string | undefined;
  onShow: (comment: CodeComment) => void; onRemove: (comment: CodeComment) => Promise<{ error?: string }>;
};

function CodeFeedbackItem({ comment, code }: { comment: CodeComment; code: CodeFeedback }) {
  const removal = useRemoval(() => code.onRemove(comment));
  const group = code.groupTitle(comment.group);
  return <section className="brief-feedback-item">
    <div className="brief-feedback-kind">Code comment{group && <span className="brief-feedback-group">{group}</span>}</div>
    <h3 className="brief-code-place">{codeCommentPlace(comment)}</h3>
    {comment.line && <pre className="brief-code-line"><code>{lineText(comment.line)}</code></pre>}
    <p>{comment.body}</p>
    {removal.error && <p className="brief-error" role="alert">{removal.error}</p>}
    <div className="brief-feedback-actions">{removal.confirming ? <>
      <span>Remove this comment? Your agent won’t see it.</span>
      <button disabled={code.saving} onClick={removal.confirm}>Remove</button>
      <button onClick={removal.keep}>Keep</button>
    </> : <>
      <button onClick={() => code.onShow(comment)}>Show in code</button>
      <button disabled={code.saving} onClick={removal.ask}>{removal.removing ? "Removing…" : "Remove"}</button>
    </>}</div>
  </section>;
}

export function BriefFeedbackView({ collection, title, review, snapshot, saving, parts = [], code, onEdit, onDelete, onLocate, onComment, onPart }: {
  collection: string; title: string; review?: { id: string; title: string }; snapshot: BriefSnapshot; saving: boolean; parts?: Part[];
  code?: CodeFeedback;
  onEdit: (entry: Extract<BriefFeedback, { kind: "comment" }>) => void;
  onDelete: (id: string) => void; onLocate: (entry: BriefFeedback) => void; onComment: () => void; onPart?: (id: string) => void;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [copied, setCopied] = useState(false);
  const partEntries = parts.reduce((sum, part) => sum + part.count, 0);
  const whole = !review && partEntries > 0;
  const codeComments = code ? sortCodeComments(code.comments) : [];
  const entries = snapshot.feedback.length + codeComments.length;
  const prepare = async () => {
    setCopied(false);
    if (!whole) {
      setPrepared({ state: "ready", text: exportBriefFeedback(title, snapshot, review?.title, codeComments, code?.groupTitle) });
      return;
    }
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
    {code && !code.loaded && code.error && <p className="brief-error" role="alert">Comments on code didn’t load, so feedback can’t be prepared yet. {code.error}</p>}
    {!entries ? <div className="brief-empty"><h3>No feedback {whole ? "on the overview" : "yet"}</h3>
      <p>{code ? "Answer a question, approve an excerpt, select a passage to comment on, or click a line number in the code." : "Answer a question, approve an excerpt, or select a passage and leave a comment."}</p></div>
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
      </section>)}
      {code && codeComments.map((comment) => <CodeFeedbackItem key={comment.id} comment={comment} code={code} />)}</div>}
    {parts.length > 0 && <section className="brief-feedback-parts"><h3>Feedback in parts</h3>
      <ul>{parts.map((part) => <li key={part.id}><button onClick={() => onPart?.(part.id)}><span>{part.title}</span><span className="pill">{part.count}</span><ArrowRight size={13} /></button></li>)}</ul>
    </section>}
    <div className="brief-handoff-actions">{(!!entries || whole) && <button className="primary" disabled={!!code && !code.loaded} onClick={prepare}>
      {whole ? `Prepare all feedback · ${snapshot.feedback.length + partEntries}` : "Prepare feedback"} <ArrowRight size={15} /></button>}
      <button className="brief-secondary" onClick={onComment}><MessageSquare size={14} /> Add a comment</button></div>
    {prepared && <BriefDialog title="Feedback, ready to hand off" onClose={() => setPrepared(null)}>
      <p className="brief-dialog-intro">{whole ? "One batch with the feature overview and every part, with answers, approved code, quoted passages, and comments on code." : `One batch with answers, approved code${codeComments.length ? ", quoted passages, and comments on code" : ", and quoted passages"}.`} Nothing is sent automatically.</p>
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
