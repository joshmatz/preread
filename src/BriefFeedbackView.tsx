import React, { useState } from "react";
import { ArrowRight, ChevronRight, Copy, MessageSquare } from "lucide-react";
import type { BriefCommand, BriefFeedback, BriefSnapshot } from "./brief-types";
import { anchorQuote, feedbackBody, feedbackCurrent, feedbackTitle } from "./brief-feedback";
import { codeCommentPlace, lineText, sortCodeComments, type CodeComment } from "./code-comments";
import { useRemoval } from "./CodeComments";
import { BriefDialog } from "./BriefDialog";
import { CommentImages, savedCommentImages } from "./CommentImages";
import { pathLanguage } from "./highlight";
import { CommentText } from "./Markdown";
import { ReplyBox, ThreadButtons, ThreadEvents, useThread, type SendThread, type ThreadControls } from "./Thread";
import { threadState, type ThreadEvent, type ThreadTurn, type Threads } from "./threads";

export type FeedbackPart = { id: string; title: string; open: number; replies: number; agent: number };
type Prepared = { state: "loading" } | { state: "ready"; text: string } | { state: "error"; message: string };
export type CodeFeedback = {
  comments: CodeComment[]; threads: Threads; loaded: boolean; saving: boolean; error: string; groupTitle: (group: string) => string | undefined;
  onShow: (comment: CodeComment) => void; onRemove: (comment: CodeComment) => Promise<{ error?: string }>;
  send: (comment: CodeComment) => SendThread;
};
type Comment = Extract<BriefFeedback, { kind: "comment" }>;

function ItemFooter({ thread, saving, removal, noun, replies, children }: {
  thread: ThreadControls; saving: boolean; removal: ReturnType<typeof useRemoval>; noun: string; replies: boolean; children?: React.ReactNode;
}) {
  return <>
    {thread.replying && <ReplyBox thread={thread} saving={saving} />}
    {(thread.error || removal.error) && <p className="brief-error" role="alert">{thread.error || removal.error}</p>}
    <div className="brief-feedback-actions">{removal.confirming ? <>
      <span>Remove this {noun}{replies ? " and its replies" : ""}? Your agent won’t see it.</span>
      <button disabled={saving} onClick={removal.confirm}>Remove</button>
      <button onClick={removal.keep}>Keep</button>
    </> : <>
      <span className={`thread-status turn-${thread.state.turn}`}>{thread.label}</span>
      <ThreadButtons thread={thread} />
      {children}
      <button disabled={saving} onClick={removal.ask}>{removal.removing ? "Removing…" : "Remove"}</button>
    </>}</div>
  </>;
}

export function BriefItem({ entry, snapshot, events, scope, saving, send, onEdit, onRemove, onLocate, collection, review }: {
  entry: BriefFeedback; snapshot: BriefSnapshot; events: ThreadEvent[]; scope: string; saving: boolean; send: SendThread;
  onEdit: (entry: Comment) => void; onRemove: () => Promise<{ error?: string }>; onLocate?: (entry: BriefFeedback) => void;
  collection: string; review?: string;
}) {
  const thread = useThread(`${scope}/${entry.id}`, entry, events, send);
  const removal = useRemoval(onRemove);
  const current = feedbackCurrent(entry, snapshot);
  return <section className={`brief-feedback-item turn-${thread.state.turn}`} tabIndex={-1}>
    <div className="brief-feedback-kind">{entry.kind === "answer" ? "Question answered" : entry.kind === "approval" ? "Code approval" : "Comment"}{!current && <span className="brief-earlier">Earlier revision</span>}</div>
    <h3>{feedbackTitle(entry)}</h3>
    {entry.kind === "comment" && anchorQuote(entry.anchor) && <blockquote className="brief-quote">{anchorQuote(entry.anchor)}</blockquote>}
    {entry.kind === "comment" ? <CommentText className="brief-feedback-text">{entry.body}</CommentText> : <p>{feedbackBody(entry)}</p>}
    {entry.kind === "comment" && <CommentImages images={savedCommentImages(collection, entry.id, entry.attachments, review)} />}
    {entry.kind === "approval" && <details><summary>Approved excerpt</summary><pre><code>{entry.block.code}</code></pre></details>}
    <ThreadEvents events={events} />
    <ItemFooter thread={thread} saving={saving} removal={removal} noun={entry.kind === "answer" ? "answer" : entry.kind === "approval" ? "approval" : "comment"} replies={events.length > 0}>
      {entry.kind === "comment" && thread.state.turn !== "resolved" && <button onClick={() => onEdit(entry)}>Edit comment</button>}
      {onLocate && entry.kind === "comment" && entry.anchor.kind !== "document" && current && <button onClick={() => onLocate(entry)}>Show in overview</button>}
    </ItemFooter>
  </section>;
}

function CodeItem({ comment, code, scope }: { comment: CodeComment; code: CodeFeedback; scope: string }) {
  const events = code.threads[comment.id] ?? [];
  const thread = useThread(`${scope}/${comment.id}`, comment, events, code.send(comment));
  const removal = useRemoval(() => code.onRemove(comment));
  const group = code.groupTitle(comment.group);
  const language = pathLanguage(comment.path);
  return <section className={`brief-feedback-item turn-${thread.state.turn}`} tabIndex={-1}>
    <div className="brief-feedback-kind">Code comment{group && <span className="brief-feedback-group">{group}</span>}</div>
    <h3 className="brief-code-place">{codeCommentPlace(comment)}</h3>
    {comment.line && <pre className="brief-code-line"><code>{lineText(comment.line)}</code></pre>}
    <CommentText className="brief-feedback-text" language={language}>{comment.body}</CommentText>
    <ThreadEvents events={events} language={language} />
    <ItemFooter thread={thread} saving={code.saving} removal={removal} noun="comment" replies={events.length > 0}>
      <button onClick={() => code.onShow(comment)}>Show in code</button>
    </ItemFooter>
  </section>;
}

const sections: Array<{ turn: ThreadTurn; title: string }> = [
  { turn: "person", title: "Waiting on you" }, { turn: "agent", title: "Waiting on your agent" }, { turn: "resolved", title: "Resolved" },
];
export function BriefFeedbackView({ ref, collection, review, snapshot, saving, parts = [], code, send, onEdit, onLocate, onComment, onPart }: {
  ref?: React.Ref<HTMLElement>; collection: string; review?: { id: string; title: string }; snapshot: BriefSnapshot; saving: boolean; parts?: FeedbackPart[];
  code?: CodeFeedback; send: (command: BriefCommand) => Promise<{ error?: string }>;
  onEdit: (entry: Comment) => void; onLocate: (entry: BriefFeedback) => void; onComment: () => void; onPart?: (id: string) => void;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [copied, setCopied] = useState(false);
  const scope = `${collection}/${review?.id ?? ""}`;
  const items = [
    ...snapshot.feedback.map((entry) => ({ key: entry.id, turn: threadState(entry, snapshot.threads[entry.id]).turn,
      node: <BriefItem key={entry.id} entry={entry} snapshot={snapshot} events={snapshot.threads[entry.id] ?? []} scope={scope} saving={saving}
        send={(command) => send({ ...command, entry: entry.id })} onRemove={() => send({ kind: "delete", id: entry.id })}
        onEdit={onEdit} onLocate={onLocate} collection={collection} review={review?.id} /> })),
    ...(code ? sortCodeComments(code.comments) : []).map((comment) => ({ key: comment.id, turn: threadState(comment, code!.threads[comment.id]).turn,
      node: <CodeItem key={comment.id} comment={comment} code={code!} scope={scope} /> })),
  ];
  const partsWaiting = review ? 0 : parts.reduce((sum, part) => sum + part.agent, 0);
  const pending = items.filter((item) => item.turn === "agent").length + partsWaiting;
  const whole = partsWaiting > 0;
  const prepare = async () => {
    setCopied(false);
    setPrepared({ state: "loading" });
    try {
      const response = await fetch(`/api/brief-export?${new URLSearchParams({ collection, ...(review ? { review: review.id } : {}) })}`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not prepare the feedback.");
      setPrepared({ state: "ready", text: value.text });
    } catch (cause) { setPrepared({ state: "error", message: cause instanceof Error ? cause.message : "Could not prepare the feedback." }); }
  };
  return <section className="brief-feedback-view" ref={ref}>
    <h2>Everything you’re handing back</h2><p className="brief-introduction">Answers, approvals, and comments include their place in the {review ? "part" : "feature"} and the content you read. Your agent replies here; resolve what’s settled.</p>
    {code && !code.loaded && code.error && <p className="brief-error" role="alert">Comments on code didn’t load, so feedback can’t be prepared yet. {code.error}</p>}
    {!items.length ? <div className="brief-empty"><h3>No feedback {parts.length ? "on the overview" : "yet"}</h3>
      <p>{code ? "Answer a question, approve an excerpt, select a passage to comment on, or click a line number in the code." : "Answer a question, approve an excerpt, or select a passage and leave a comment."}</p></div>
      : sections.map(({ turn, title }) => {
        const list = items.filter((item) => item.turn === turn);
        if (!list.length) return null;
        const heading = <>{title} <span className={turn === "person" ? "pill has-replies" : "pill"}>{list.length}</span></>;
        return turn === "resolved"
          ? <details key={turn} className="brief-turn-group resolved-group" data-turn={turn}><summary><ChevronRight size={14} className="resolved-chevron" aria-hidden="true" />{heading}</summary><div className="brief-feedback-list">{list.map((item) => item.node)}</div></details>
          : <section key={turn} className="brief-turn-group" data-turn={turn}><h3 className="brief-turn-title">{heading}</h3><div className="brief-feedback-list">{list.map((item) => item.node)}</div></section>;
      })}
    {parts.length > 0 && <section className="brief-feedback-parts"><h3>Feedback in parts</h3>
      <ul>{parts.map((part) => <li key={part.id}><button onClick={() => onPart?.(part.id)}><span>{part.title}</span>
        {part.replies > 0 && <span className="pill has-replies">{part.replies === 1 ? "1 reply" : `${part.replies} replies`}</span>}
        <span className="pill" title="Open items">{part.open}</span><ArrowRight size={13} /></button></li>)}</ul>
    </section>}
    <div className="brief-handoff-actions">{pending > 0 && <button className="primary" disabled={!!code && !code.loaded} onClick={prepare}>
      {whole ? "Prepare all feedback" : "Prepare feedback"} · {pending} <ArrowRight size={15} /></button>}
      <button className="brief-secondary" onClick={onComment}><MessageSquare size={14} /> Add a comment</button></div>
    {prepared && <BriefDialog title="Feedback, ready to hand off" onClose={() => setPrepared(null)}>
      <p className="brief-dialog-intro">{whole ? "One batch with what’s waiting on your agent in the feature overview and every part." : "One batch with what’s waiting on your agent."} Each item has an ID your agent uses to reply here. Nothing is sent automatically.</p>
      {prepared.state === "loading" ? <p className="muted" role="status">Collecting feedback…</p>
        : prepared.state === "error" ? <p className="brief-error" role="alert">{prepared.message}</p>
        : <><label className="brief-field-label" htmlFor="brief-export">Prepared feedback</label><textarea id="brief-export" className="brief-export" readOnly value={prepared.text} />
          <div className="brief-dialog-actions"><span role="status">{copied ? "Copied. Nothing has been sent." : "Copy this into the conversation where work continues."}</span><button className="primary" onClick={async () => {
            try { await navigator.clipboard.writeText(prepared.text); setCopied(true); }
            catch { const field = document.getElementById("brief-export"); if (field instanceof HTMLTextAreaElement) { field.focus(); field.select(); } }
          }}><Copy size={14} /> Copy feedback</button></div></>}
    </BriefDialog>}
  </section>;
}
