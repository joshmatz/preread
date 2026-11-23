import React, { useLayoutEffect, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { threadState, type ThreadCommand, type ThreadEvent, type ThreadRoot, type ThreadState } from "./threads";
import { CommentText } from "./Markdown";

export type SendThread = (command: ThreadCommand) => Promise<{ error?: string }>;
type ReplyDraft = { id: string; text: string };
// Per tab, like unsaved comments, so a reload keeps a reply being written.
const storageKey = "preread-reply-drafts";
const readDrafts = (): Record<string, ReplyDraft> => {
  try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "{}") ?? {}; } catch { return {}; }
};
function writeDraft(key: string, draft: ReplyDraft | null) {
  const drafts = readDrafts();
  if (draft?.text.trim()) drafts[key] = draft;
  else delete drafts[key];
  try {
    if (Object.keys(drafts).length) sessionStorage.setItem(storageKey, JSON.stringify(drafts));
    else sessionStorage.removeItem(storageKey);
  } catch {}
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function Time({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value} title={exact.format(date)}>{date.toDateString() === new Date().toDateString() ? clock.format(date) : day.format(date)}</time>;
}
const who = (event: ThreadEvent) => event.author === "agent" ? "Your agent" : "You";

export function threadLabel(state: ThreadState, events: number) {
  if (state.turn === "resolved") return state.by === "agent" ? "Resolved by your agent" : "Resolved";
  if (state.turn === "person") return "Your agent replied";
  return events ? "Waiting on your agent" : "For your agent";
}

export function ThreadEvents({ events, language }: { events: ThreadEvent[]; language?: string }) {
  if (!events.length) return null;
  return <ol className="thread-events">{events.map((event) => event.body === undefined
    ? <li key={event.id} className="thread-event thread-change">
      {event.resolved ? <Check size={12} aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />}
      <span>{who(event)} {event.resolved ? "resolved this" : "reopened this"}</span><Time value={event.createdAt} />
    </li>
    : <li key={event.id} className={`thread-event thread-reply from-${event.author}`}>
      <div className="thread-author"><strong>{who(event)}</strong><Time value={event.createdAt} />
        {event.resolved && <span className="thread-resolved-tag"><Check size={11} aria-hidden="true" />Resolved</span>}</div>
      <CommentText className="thread-body" language={language}>{event.body}</CommentText>
    </li>)}</ol>;
}

type FocusTarget = "reply" | "toggle" | "hide" | "field";
// A closing reply box, a disabled button or a card that folds drops focus on the page; an intent puts it back once the new element renders.
// Intents live outside the component because on the Feedback tab an item whose turn changes remounts in another section.
const intents = new Map<string, { target: FocusTarget; at: number; selection?: [number, number] }>();
const intend = (key: string, target: FocusTarget, selection?: [number, number]) => { intents.set(key, { target, at: Date.now(), selection }); };
function intended(key: string, target: FocusTarget) {
  const intent = intents.get(key);
  // One nobody takes in time, such as for an item removed meanwhile, must not move focus later.
  if (intent && Date.now() - intent.at > 10_000) intents.delete(key);
  else if (intent?.target === target) return intent;
}
export function useThread(draftKey: string, root: ThreadRoot, events: ThreadEvent[], send: SendThread) {
  const state = threadState(root, events);
  // A reply restored after a reload opens without taking focus.
  const [replying, setReplying] = useState<"" | "open" | "restored">(() => readDrafts()[draftKey] ? "restored" : "");
  const [busy, setBusy] = useState<"" | "resolve" | "reopen">("");
  const [error, setError] = useState("");
  // The box this item had before it moved records its intent while this copy renders, so look once the page has both.
  useLayoutEffect(() => { if (!replying && intended(draftKey, "field")) setReplying("open"); }, []);
  const focusRef = (target: FocusTarget) => (node: HTMLButtonElement | null) => {
    if (!node || node.disabled || !intended(draftKey, target)) return;
    // In a folded section the button can't take focus, so the section's summary does.
    const element = node.closest("details:not([open])")?.querySelector<HTMLElement>(":scope > summary") ?? node;
    // A copy in a hidden view leaves the intent to the one on screen.
    if (!element.getClientRects().length) return;
    if (!document.activeElement || document.activeElement === document.body) element.focus();
    intents.delete(draftKey);
  };
  const change = async (kind: "resolve" | "reopen") => {
    intend(draftKey, "toggle");
    setBusy(kind); setError("");
    const result = await send({ kind });
    setBusy(""); setError(result.error ?? "");
  };
  return { state, label: threadLabel(state, events.length), replying, busy, error, draftKey, send, focusRef,
    focusNext: (target: FocusTarget) => intend(draftKey, target),
    reply: () => { setError(""); setReplying("open"); }, closeReply: () => { intend(draftKey, "reply"); setReplying(""); },
    resolve: () => change("resolve"), reopen: () => change("reopen") };
}
export type ThreadControls = ReturnType<typeof useThread>;

export function ReplyBox({ thread, saving }: { thread: ThreadControls; saving: boolean }) {
  const [draft, setDraft] = useState<ReplyDraft>(() => readDrafts()[thread.draftKey] ?? { id: crypto.randomUUID(), text: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const closing = useRef(false);
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    const moved = intended(thread.draftKey, "field");
    if (moved) intents.delete(thread.draftKey);
    if (moved || thread.replying === "open") {
      node.focus();
      node.setSelectionRange(...(moved?.selection ?? [draft.text.length, draft.text.length]));
    }
    // Runs while the textarea is still on the page, so a box removed mid-reply because its item moved reopens focused where it was.
    return () => { if (!closing.current && document.activeElement === node) intend(thread.draftKey, "field", [node.selectionStart, node.selectionEnd]); };
  }, []);
  const change = (text: string) => {
    const next = { ...draft, text };
    setDraft(next);
    writeDraft(thread.draftKey, next);
  };
  const close = () => { closing.current = true; writeDraft(thread.draftKey, null); thread.closeReply(); };
  const submit = async () => {
    if (!draft.text.trim() || saving || busy) return;
    setBusy(true); setError("");
    const result = await thread.send({ kind: "reply", id: draft.id, body: draft.text });
    setBusy(false);
    if (result.error) setError(result.error);
    else close();
  };
  return <form className="reply-box" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <textarea ref={field} aria-label="Reply to your agent" value={draft.text} maxLength={12000} rows={2} placeholder="Reply to your agent"
      onChange={(event) => change(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
        else if (event.key === "Escape" && !draft.text.trim()) { event.preventDefault(); close(); }
      }} />
    {error && <p className="thread-error" role="alert">{error}</p>}
    <div className="reply-actions">
      <small>{thread.state.turn === "resolved" ? "Replying reopens this for your agent." : "Your agent reads replies with your feedback."}</small>
      <button type="button" onClick={close}>Cancel</button>
      <button className="primary" type="submit" disabled={saving || busy || !draft.text.trim()} title="Reply (⌘↩)">{busy ? "Replying…" : "Reply"}</button>
    </div>
  </form>;
}

// The buttons a thread adds to its card's footer.
export function ThreadButtons({ thread, onHide }: { thread: ThreadControls; onHide?: () => void }) {
  const resolved = thread.state.turn === "resolved";
  return <>
    {!thread.replying && <button ref={thread.focusRef("reply")} onClick={thread.reply}>Reply</button>}
    {resolved ? <button ref={thread.focusRef("toggle")} disabled={!!thread.busy} onClick={thread.reopen}>{thread.busy === "reopen" ? "Reopening…" : "Reopen"}</button>
      : <button ref={thread.focusRef("toggle")} disabled={!!thread.busy} onClick={thread.resolve}>{thread.busy === "resolve" ? "Resolving…" : "Resolve"}</button>}
    {resolved && onHide && <button ref={thread.focusRef("hide")} onClick={() => { thread.focusNext("toggle"); onHide(); }}>Hide</button>}
  </>;
}
