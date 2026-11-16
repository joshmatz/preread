import React, { useEffect, useRef, useState } from "react";
import { codeCommentPlace, lineText, sortCodeComments, type CodeComment, type CodeLine } from "./code-comments";

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
  remove: (comment: CodeComment) => void;
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

function Comment({ comment, drafts, actions, place }: { comment: CodeComment; drafts: Record<string, CodeDraft>; actions: CommentActions; place?: React.ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const draft = drafts[editKey(comment)];
  if (draft) return <Composer draftKey={editKey(comment)} draft={draft} actions={actions} place={place} />;
  const removeKey = `remove:${comment.id}`;
  return <article className="code-comment">
    {place}
    <p className="code-comment-body">{comment.body}</p>
    {actions.error(removeKey) && <p className="code-comment-error" role="alert">{actions.error(removeKey)}</p>}
    <footer>{confirming ? <>
      <span>Remove this comment? Your agent won’t see it.</span>
      <button disabled={actions.saving} onClick={() => { setConfirming(false); actions.remove(comment); }}>Remove</button>
      <button onClick={() => setConfirming(false)}>Keep</button>
    </> : <>
      <span>For your agent</span>
      <button onClick={() => actions.edit(comment)}>Edit</button>
      <button disabled={actions.saving} onClick={() => setConfirming(true)}>{actions.busy(removeKey) ? "Removing…" : "Remove"}</button>
    </>}</footer>
  </article>;
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

function UnplacedComment({ comment, group, saving, onRemove }: {
  comment: CodeComment; group?: string; saving: boolean; onRemove: (comment: CodeComment) => Promise<{ error?: string }>;
}) {
  const removal = useRemoval(() => onRemove(comment));
  return <article className="code-comment">
    <div className="code-comment-place">{codeCommentPlace(comment)}{group && ` · ${group}`}{comment.line && <code>{lineText(comment.line)}</code>}</div>
    <p className="code-comment-body">{comment.body}</p>
    {removal.error && <p className="code-comment-error" role="alert">{removal.error}</p>}
    <footer>{removal.confirming ? <>
      <span>Remove this comment? Your agent won’t see it.</span>
      <button disabled={saving} onClick={removal.confirm}>Remove</button>
      <button onClick={removal.keep}>Keep</button>
    </> : <>
      <span>For your agent</span>
      <button disabled={saving} onClick={removal.ask}>{removal.removing ? "Removing…" : "Remove"}</button>
    </>}</footer>
  </article>;
}

export function UnplacedComments({ comments, groupTitle, saving, onRemove }: {
  comments: CodeComment[]; groupTitle: (group: string) => string | undefined; saving: boolean;
  onRemove: (comment: CodeComment) => Promise<{ error?: string }>;
}) {
  if (!comments.length) return null;
  return <section className="unplaced-comments" id="unplaced-comments" aria-labelledby="unplaced-comments-title">
    <h2 id="unplaced-comments-title">Comments on files no longer in this review</h2>
    <p>Your agent still reads these with the review’s feedback. Remove any that no longer apply.</p>
    {sortCodeComments(comments).map((comment) => <UnplacedComment key={comment.id} comment={comment} group={groupTitle(comment.group)}
      saving={saving} onRemove={onRemove} />)}
  </section>;
}
