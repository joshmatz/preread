import React, { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { codeCommentPlace, lineText, sortCodeComments, type CodeComment, type CodeLine } from "./code-comments";
import { ReplyBox, ThreadButtons, ThreadEvents, useThread, type SendThread } from "./Thread";
import type { ThreadEvent, Threads } from "./threads";

export type CodeDraft = { id: string; text: string; line?: CodeLine; comment?: CodeComment };
export type CommentActions = {
  saving: boolean;
  busy: (key: string) => boolean;
  error: (key: string) => string;
  focus: (key: string) => boolean;
  change: (key: string, text: string) => void;
  save: (key: string) => void;
  cancel: (key: string) => void;
  edit: (comment: CodeComment) => void;
  remove: (comment: CodeComment) => Promise<{ error?: string }>;
  events: (comment: CodeComment) => ThreadEvent[];
  thread: (comment: CodeComment) => SendThread;
  // Keys this review's reply drafts.
  scope: string;
};
export const editKey = (comment: CodeComment) => `edit:${comment.id}`;
const agentNote = "Your agent reads this with the review’s feedback.";
const elsewhere = (line: CodeLine) => <div className="code-comment-place">
  Line {line.number}{line.side === "old" ? " (removed)" : ""} · not in the diff shown here<code>{lineText(line)}</code></div>;

function Composer({ draftKey, draft, actions, hint = agentNote, place }: {
  draftKey: string; draft: CodeDraft; actions: CommentActions; hint?: string; place?: React.ReactNode;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const editing = !!draft.comment;
  useEffect(() => {
    if (!actions.focus(draftKey) || !field.current) return;
    field.current.focus();
    field.current.setSelectionRange(draft.text.length, draft.text.length);
  }, []);
  const save = () => { if (draft.text.trim() && !actions.saving) actions.save(draftKey); };
  const label = editing ? "Edit comment" : draft.line ? `Comment on line ${draft.line.number}` : "Comment on this file";
  return <form className="code-comment-composer" data-draft={draftKey} onSubmit={(event) => { event.preventDefault(); save(); }}>
    {place}
    <textarea ref={field} aria-label={label} value={draft.text} maxLength={12000} rows={3} placeholder="Comment for the agent"
      onChange={(event) => actions.change(draftKey, event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
        else if (event.key === "Escape" && (!draft.text.trim() || draft.text === draft.comment?.body)) { event.preventDefault(); actions.cancel(draftKey); }
      }} />
    {actions.error(draftKey) && <p className="code-comment-error" role="alert">{actions.error(draftKey)}</p>}
    <div className="code-comment-actions">
      <small>{hint}</small>
      <button type="button" className="code-comment-cancel" onClick={() => actions.cancel(draftKey)}>Cancel</button>
      <button className="primary" type="submit" disabled={actions.saving || !draft.text.trim()} title="Save (⌘↩)">
        {actions.busy(draftKey) ? "Saving…" : editing ? "Save changes" : "Save comment"}</button>
    </div>
  </form>;
}

function CommentCard({ comment, place, events, send, draftKey, saving, onEdit, onRemove }: {
  comment: CodeComment; place?: React.ReactNode; events: ThreadEvent[]; send: SendThread; draftKey: string; saving: boolean;
  onEdit?: () => void; onRemove: () => Promise<{ error?: string }>;
}) {
  const thread = useThread(draftKey, comment, events, send);
  const removal = useRemoval(onRemove);
  const resolved = thread.state.turn === "resolved";
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!resolved) setExpanded(false); }, [resolved]);
  if (resolved && !expanded && !thread.replying) return <article className="code-comment resolved-comment">
    {place}
    <button ref={thread.focusRef("toggle")} className="thread-summary" aria-expanded="false" onClick={() => { thread.focusNext("hide"); setExpanded(true); }}>
      <Check size={13} aria-hidden="true" /><span className="thread-summary-label">{thread.label}</span>
      <span className="thread-summary-text">{comment.body}</span><span className="thread-summary-show">Show</span>
    </button>
  </article>;
  return <article className={`code-comment${thread.state.turn === "person" ? " agent-replied" : ""}${resolved ? " resolved-comment" : ""}`}>
    {place}
    <p className="code-comment-body">{comment.body}</p>
    <ThreadEvents events={events} />
    {thread.replying && <ReplyBox thread={thread} saving={saving} />}
    {(removal.error || thread.error) && <p className="code-comment-error" role="alert">{removal.error || thread.error}</p>}
    <footer>{removal.confirming ? <>
      <span>Remove this comment{events.length ? " and its replies" : ""}? Your agent won’t see it.</span>
      <button disabled={saving} onClick={removal.confirm}>Remove</button>
      <button onClick={removal.keep}>Keep</button>
    </> : <>
      <span className={`thread-status turn-${thread.state.turn}`}>{thread.label}</span>
      <ThreadButtons thread={thread} onHide={() => setExpanded(false)} />
      {!resolved && onEdit && <button onClick={onEdit}>Edit</button>}
      <button disabled={saving} onClick={removal.ask}>{removal.removing ? "Removing…" : "Remove"}</button>
    </>}</footer>
  </article>;
}

function Comment({ comment, drafts, actions, place }: { comment: CodeComment; drafts: Record<string, CodeDraft>; actions: CommentActions; place?: React.ReactNode }) {
  const draft = drafts[editKey(comment)];
  if (draft) return <Composer draftKey={editKey(comment)} draft={draft} actions={actions} place={place} />;
  return <CommentCard comment={comment} place={place} events={actions.events(comment)} send={actions.thread(comment)}
    draftKey={`${actions.scope}/${comment.id}`} saving={actions.saving} onEdit={() => actions.edit(comment)} onRemove={() => actions.remove(comment)} />;
}

export function LineThread({ comments, draftKeys, drafts, actions }: {
  comments: CodeComment[]; draftKeys: string[]; drafts: Record<string, CodeDraft>; actions: CommentActions;
}) {
  return <div className="code-thread">
    {comments.map((comment) => <Comment key={comment.id} comment={comment} drafts={drafts} actions={actions} />)}
    {draftKeys.map((key) => drafts[key] && <Composer key={key} draftKey={key} draft={drafts[key]} actions={actions} />)}
  </div>;
}

export function FileComments({ comments, stray, strayDrafts, drafts, actions, lineHint, note, onSendNote, onDeleteNote }: {
  comments: CodeComment[]; stray: CodeComment[]; strayDrafts: string[]; drafts: Record<string, CodeDraft>; actions: CommentActions; lineHint: boolean;
  note: string; onSendNote?: () => void; onDeleteNote: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  if (!comments.length && !stray.length && !strayDrafts.length && !drafts.file && !note) return null;
  return <section className="file-comments" aria-label="Comments on this file">
    {comments.map((comment) => <Comment key={comment.id} comment={comment} drafts={drafts} actions={actions}
      place={<div className="code-comment-place">On this file</div>} />)}
    {stray.map((comment) => <Comment key={comment.id} comment={comment} drafts={drafts} actions={actions} place={elsewhere(comment.line!)} />)}
    {strayDrafts.map((key) => <Composer key={key} draftKey={key} draft={drafts[key]} actions={actions} place={elsewhere(drafts[key].line!)} />)}
    {drafts.file && <Composer draftKey="file" draft={drafts.file} actions={actions}
      hint={lineHint ? `${agentNote} To comment on one line, click its number.` : agentNote} />}
    {note && <div className="legacy-note">
      <div className="code-comment-place">Private note from before comments · only in this browser</div>
      <p className="code-comment-body">{note}</p>
      {actions.error("note") && <p className="code-comment-error" role="alert">{actions.error("note")}</p>}
      <footer>{deleting ? <>
        <span>Delete this note? It can’t be restored.</span>
        <button onClick={() => { setDeleting(false); onDeleteNote(); }}>Delete</button>
        <button onClick={() => setDeleting(false)}>Keep</button>
      </> : <>
        {onSendNote && <button disabled={actions.saving} onClick={onSendNote}>{actions.busy("note") ? "Sending…" : "Send as a comment"}</button>}
        <button onClick={() => setDeleting(true)}>Delete note</button>
      </>}</footer>
    </div>}
  </section>;
}

export function useRemoval(remove: () => Promise<{ error?: string }>) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  return { confirming, removing, error, ask: () => setConfirming(true), keep: () => setConfirming(false), confirm: async () => {
    setConfirming(false); setRemoving(true); setError("");
    const result = await remove();
    setRemoving(false); setError(result.error ?? "");
  } };
}

export function UnplacedComments({ comments, threads, scope, groupTitle, saving, send, onRemove }: {
  comments: CodeComment[]; threads: Threads; scope: string; groupTitle: (group: string) => string | undefined; saving: boolean;
  send: (comment: CodeComment) => SendThread; onRemove: (comment: CodeComment) => Promise<{ error?: string }>;
}) {
  if (!comments.length) return null;
  return <section className="unplaced-comments" id="unplaced-comments" aria-labelledby="unplaced-comments-title">
    <h2 id="unplaced-comments-title">Comments on files no longer in this review</h2>
    <p>Your agent still reads these with the review’s feedback. Resolve or remove any that no longer apply.</p>
    {sortCodeComments(comments).map((comment) => {
      const group = groupTitle(comment.group);
      return <CommentCard key={comment.id} comment={comment} events={threads[comment.id] ?? []} send={send(comment)} draftKey={`${scope}/${comment.id}`}
        saving={saving} onRemove={() => onRemove(comment)}
        place={<div className="code-comment-place">{codeCommentPlace(comment)}{group && ` · ${group}`}{comment.line && <code>{lineText(comment.line)}</code>}</div>} />;
    })}
  </section>;
}
