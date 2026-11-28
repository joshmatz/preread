import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, CheckCheck, LoaderCircle, MessageSquare, X } from "lucide-react";
import type { Collection, ProgressSource, Review, ReviewProgress } from "./review-types";
import type { BriefAnchor, BriefBlock, BriefFeedback, BriefReference } from "./brief-types";
import { anchorQuote, blockTitle, feedbackBody, feedbackCurrent, feedbackTitle, groupTitleIn } from "./brief-feedback";
import { captureBriefSelection, rangeForSegment, textOffset } from "./brief-selection";
import type { BriefState } from "./useBrief";
import type { CodeComments } from "./useCodeComments";
import { sortCodeComments, type CodeJump } from "./code-comments";
import { useBriefAnnotations } from "./useBriefAnnotations";
import { BriefDialog } from "./BriefDialog";
import { BriefFeedbackView, BriefItem } from "./BriefFeedbackView";
import { noThreads, openThreads, threadCounts, threadState, type ThreadEvent, type ThreadTurn } from "./threads";
import { BriefQuestion } from "./BriefQuestion";
import { BriefTabs } from "./BriefTabs";
import { BriefVisual } from "./BriefVisual";
import { Markdown, plainText, type BriefLink } from "./Markdown";
import { HighlightedCode } from "./HighlightedCode";
import { CallTree } from "./CallTree";
import { BriefCommentEditor, type BriefCommentDraft } from "./BriefCommentEditor";
import { BriefGroupStatus, groupReadState, type GroupReadState } from "./BriefGroupStatus";
import { BriefContents, headingCounts, PartStatus, type ContentsGroup } from "./BriefContents";
import { BriefCodeGroups, groupTitle, type MarkGroups } from "./BriefCodeGroups";
import { briefStructure, type BriefStructure, type OutlineHeading } from "./brief-outline";
import { codeGroups } from "./progress";
import { Description } from "./Description";
import { partTree } from "./part-tree";
import { ReviewFrame } from "./ReviewFrame";
import { onScreen, reached, useScrollPlace } from "./scroll-place";
import "./brief.css";

type Comment = Extract<BriefFeedback, { kind: "comment" }>;
type Modal = ({ kind: "comment" } & BriefCommentDraft) | { kind: "notes"; ids: string[] };
type View = "brief" | "feedback";
type ReadingPlace = { block: string; offset: number };
// A brief unmounts while its code is open, so the reader's place is kept outside it.
// It is kept relative to a block: visuals above it load again after a remount and would move a plain scroll offset.
// A reload keeps the tab's places; a newly opened link starts where it points.
const placesKey = "preread-reading-places";
const readingPositions = new Map<string, ReadingPlace>(((): [string, ReadingPlace][] => {
  try {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type !== "reload" && navigation?.type !== "back_forward") return [];
    return Object.entries(JSON.parse(sessionStorage.getItem(placesKey) ?? "{}") as Record<string, ReadingPlace>);
  } catch { return []; }
})());
window.addEventListener("pagehide", () => {
  try { sessionStorage.setItem(placesKey, JSON.stringify(Object.fromEntries(readingPositions))); } catch {}
});
const emptyStructure: BriefStructure = { outline: [], sections: [], headings: new Map(), owners: new Map() };
const headingElement = (heading: OutlineHeading) => document.getElementById(`brief-block-${heading.block}`)
  ?.querySelectorAll<HTMLElement>("[data-brief-text] > .markdown > :is(h1,h2,h3)")[heading.index];

export function FeatureBrief({ collection, review, brief, pullRequests, progress, sources, marking, initialView = "brief", initialBlock, initialFeedback, onJumped, onCode, onReview, onFeature, onCodeTab, onMark, codeComments }: {
  collection: Collection; review?: Review; brief: BriefState; pullRequests?: ReactNode; progress: Record<string, ReviewProgress>; sources: Record<string, ProgressSource>;
  marking: string; initialView?: View; initialBlock?: string; initialFeedback?: ThreadTurn; onJumped?: () => void; onCode: (reference: CodeJump, view: View) => void;
  onReview: (review: string, block?: string, open?: "feedback" | "replies") => void; onFeature: () => void; onCodeTab?: () => void; onMark: MarkGroups;
  codeComments?: CodeComments;
}) {
  const { snapshot, error, saving, save, send, retry } = brief;
  const [view, setView] = useState<View>(initialView);
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState("");
  const [offsets, setOffsets] = useState<Record<string, number>>();
  const text = useRef<HTMLElement>(null);
  const placed = useRef(false);
  const initialTarget = useRef(initialBlock ?? "");
  const annotations = useBriefAnnotations(text, snapshot, view === "brief", !!modal);
  const structure = useMemo(() => snapshot ? briefStructure(snapshot.brief) : emptyStructure, [snapshot?.version]);
  const { outline, sections } = structure;
  const subject = review ? "part" : "feature";
  const readingKey = review ? `${collection.id}/${review.id}` : collection.id;
  const partIndex = review ? collection.reviews.findIndex((entry) => entry.id === review.id) : -1;
  const edit = (entry: Comment) => setModal({ kind: "comment", id: entry.id, anchor: entry.anchor, body: entry.body, attachments: entry.attachments });
  // A removed comment takes its dialog with it.
  useEffect(() => {
    if (modal?.kind === "notes" && snapshot && !snapshot.feedback.some((entry) => modal.ids.includes(entry.id))) setModal(null);
  }, [modal, snapshot]);
  const comment = (anchor: BriefAnchor) => {
    annotations.clearSelection();
    setModal({ kind: "comment", id: crypto.randomUUID(), anchor, body: "", attachments: [] });
  };
  const selectedComment = () => {
    if (!snapshot || !text.current) return;
    const anchor = annotations.selection?.anchor ?? captureBriefSelection(text.current, snapshot);
    if (anchor) comment(anchor); else setNotice("Select a passage, then add your comment.");
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === "KeyM" && !modal) { event.preventDefault(); selectedComment(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [snapshot, modal, annotations.selection]);
  const groupExists = (reference: BriefReference) =>
    !!collection.reviews.find((entry) => entry.id === reference.review)?.groups.some((group) => group.id === reference.group)
    || !!sources[reference.review]?.sections.some((section) => section.id === reference.group);
  const openCode = (reference: BriefReference) => {
    if (!groupExists(reference)) { setNotice("That code group is no longer in this feature."); return; }
    onCode(reference, view);
  };
  const referenceState = (reference: BriefReference): GroupReadState => {
    if (!collection.reviews.some((entry) => entry.id === reference.review) || !groupExists(reference))
      return { kind: "unavailable", message: "This code group is no longer in the feature." };
    return groupReadState({ group: reference.group, source: sources[reference.review], progress: progress[reference.review] });
  };
  const openLink = (link: BriefLink) => {
    if (link.group) openCode({ review: link.review, group: link.group });
    else if (collection.reviews.some((entry) => entry.id === link.review)) onReview(link.review);
    else setNotice("That part is no longer in this feature.");
  };
  const linkState = (link: BriefLink): GroupReadState | undefined => {
    if (link.group) return referenceState({ review: link.review, group: link.group });
    return collection.reviews.some((entry) => entry.id === link.review) ? undefined
      : { kind: "unavailable", message: "This part is no longer in the feature." };
  };
  const hold = useRef(() => {});
  const pending = useRef<(() => void) | null>(null);
  const chosen = useRef("");
  const feedbackView = useRef<HTMLElement>(null);
  const feedbackTurn = useRef(initialFeedback);
  const [feedbackRequest, setFeedbackRequest] = useState(0);
  const showFeedback = (turn: ThreadTurn) => {
    hold.current();
    feedbackTurn.current = turn;
    setFeedbackRequest((value) => value + 1);
    setView("feedback");
  };
  // Switching back from Feedback restores the old place in a layout effect, so a pending target replaces that restore.
  const reveal = (position: () => void) => {
    hold.current();
    chosen.current = "";
    initialTarget.current = "";
    if (view === "brief") hold.current = holdPosition(text.current, position);
    else { pending.current = position; setView("brief"); }
  };
  // A target is a block ID or a heading key, `<block>:<index>`; block IDs can't contain a colon.
  const positionOf = (id: string) => () => {
    const heading = outline.find((entry) => entry.key === id);
    const block = document.getElementById(`brief-block-${heading?.block ?? id.split(":")[0]}`);
    const element = (heading && headingElement(heading)) || block;
    if (!element) return;
    element.scrollIntoView({ block: element === block ? "center" : "start" });
    block?.focus({ preventScroll: true });
  };
  const jump = (id: string) => reveal(positionOf(id));
  const jumpHeading = (heading: OutlineHeading) => {
    reveal(positionOf(heading.key));
    chosen.current = heading.key;
    setActive(heading.key);
  };
  const toTop = () => reveal(() => { window.scrollTo(0, 0); text.current?.focus({ preventScroll: true }); });
  const locate = (entry: BriefFeedback) => {
    if (entry.kind !== "comment" || !snapshot) return;
    const anchor = entry.anchor;
    if (anchor.kind === "block") { jump(anchor.block); return; }
    if (anchor.kind !== "selection") return;
    reveal(() => {
      if (!text.current) return;
      const range = rangeForSegment(text.current, anchor.segments[0]);
      // A call tree hides source text behind its labels and inside folded steps; scroll to what shows.
      let node = range?.startContainer.parentElement;
      while (node && !node.getClientRects().length) node = node.parentElement;
      if (node) { node.scrollIntoView({ block: "center" }); text.current.focus({ preventScroll: true }); }
    });
  };
  useLayoutEffect(() => {
    if (!snapshot) return;
    const first = !placed.current;
    placed.current = true;
    if (view !== "brief") { initialTarget.current = ""; if (first) window.scrollTo(0, 0); return; }
    // The link's target stays until the reader navigates, so Strict Mode's second run jumps again instead of restoring.
    const target = pending.current ?? (initialTarget.current ? positionOf(initialTarget.current) : null);
    pending.current = null;
    if (initialTarget.current) onJumped?.();
    const reading = readingPositions.get(readingKey);
    if (target) hold.current = holdPosition(text.current, target);
    else if (reading) hold.current = holdPosition(text.current, () => restoreReadingPlace(reading));
    else window.scrollTo(0, 0);
    const record = () => {
      const place = readingPlace(text.current);
      if (place) readingPositions.set(readingKey, place);
    };
    window.addEventListener("scroll", record, { passive: true });
    return () => { window.removeEventListener("scroll", record); hold.current(); };
  }, [!!snapshot, view]);
  // Feedback is shorter than the overview, so the scroll it keeps from there would land below the threads.
  const codeLoading = !!(review && codeComments?.enabled && !codeComments.loaded && !codeComments.error);
  useLayoutEffect(() => {
    const turn = feedbackTurn.current;
    if (view !== "feedback" || !snapshot || !turn || codeLoading) return;
    feedbackTurn.current = undefined;
    onJumped?.();
    const group = feedbackView.current?.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    if (!group) { window.scrollTo(0, 0); return; }
    if (group instanceof HTMLDetailsElement) group.open = true;
    hold.current = holdPosition(feedbackView.current, () => group.scrollIntoView({ block: "start" }));
    group.querySelector<HTMLElement>(":scope > summary, .brief-feedback-item")?.focus({ preventScroll: true });
    return () => hold.current();
  }, [view, !!snapshot, feedbackRequest, codeLoading]);
  const following = view === "brief" && outline.length > 0;
  useEffect(() => { if (!following) setActive(""); }, [following]);
  useScrollPlace(following, () => {
    const picked = chosen.current && outline.find((heading) => heading.key === chosen.current);
    if (picked && onScreen(headingElement(picked))) { setActive(picked.key); return; }
    chosen.current = "";
    let current = outline[0].key;
    for (const heading of outline) {
      const element = headingElement(heading);
      if (!element) continue;
      if (reached(element)) current = heading.key;
      else break;
    }
    setActive(current);
  }, () => { chosen.current = ""; }, [outline]);
  // Selections store offsets into a block's text, so each heading's offset there says which heading a comment falls under.
  useLayoutEffect(() => {
    if (view !== "brief") { setOffsets(undefined); return; }
    const next: Record<string, number> = {};
    for (const heading of outline) {
      const element = headingElement(heading);
      const root = element?.closest<HTMLElement>("[data-brief-text]");
      if (element && root) next[heading.key] = textOffset(root, element, 0);
    }
    setOffsets((previous) => previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [view, outline]);
  if (!snapshot) return <div className="feature-brief feature-brief-loading">{error
    ? <div className="brief-error" role="alert">{error}<button onClick={retry}>Try again</button></div>
    : <div className="loading" role="status"><LoaderCircle size={18} className="spin" /> Loading {review ? "this part’s" : "the feature"} overview…</div>}</div>;
  const current = snapshot.feedback.filter((entry) => feedbackCurrent(entry, snapshot));
  const questions = snapshot.brief.blocks.filter((block) => block.kind === "question");
  const unanswered = questions.filter((block) => !current.some((entry) => entry.kind === "answer" && entry.block.id === block.id));
  const approvals = snapshot.brief.blocks.filter((block) => block.kind === "code" && block.approval);
  const unapproved = approvals.filter((block) => !current.some((entry) => entry.kind === "approval" && entry.block.id === block.id));
  const notes = snapshot.feedback.filter((entry): entry is Comment => entry.kind === "comment");
  const resolved = (entry: BriefFeedback) => threadState(entry, snapshot.threads[entry.id]).turn === "resolved";
  const openNotes = notes.filter((entry) => !resolved(entry));
  const marksIn = (block: string) => openNotes.flatMap((entry) => entry.anchor.kind === "selection" && feedbackCurrent(entry, snapshot)
    ? entry.anchor.segments.flatMap((segment): Array<[number, number]> => segment.block === block ? [[segment.start, segment.end]] : []) : []);
  const codeFeedback = review && codeComments ? codeComments : undefined;
  const own = threadCounts(snapshot.feedback, snapshot.threads, codeFeedback ? threadCounts(codeFeedback.comments, codeFeedback.threads) : noThreads());
  const lastAgentWord = (events: ThreadEvent[] = []) => plainText(events.filter((event) => event.author === "agent").at(-1)?.body ?? "");
  const replies = [
    ...snapshot.feedback.filter((entry) => threadState(entry, snapshot.threads[entry.id]).turn === "person").map((entry) => lastAgentWord(snapshot.threads[entry.id])),
    ...(codeFeedback ? sortCodeComments(codeFeedback.comments).filter((comment) => threadState(comment, codeFeedback.threads[comment.id]).turn === "person")
      .map((comment) => lastAgentWord(codeFeedback.threads[comment.id])) : []),
  ];
  const partReplies = review ? [] : collection.reviews.flatMap((entry) => {
    const count = (snapshot.attention?.reviews[entry.id]?.threads.person ?? 0) + (snapshot.attention?.code?.[entry.id]?.person ?? 0);
    return count ? [{ review: entry, count }] : [];
  });
  const counts = headingCounts(snapshot, structure, offsets);
  const partAttention = review ? [] : collection.reviews.flatMap((entry, index) => {
    const value = snapshot.attention?.reviews[entry.id];
    return value ? [{ review: entry, index, ...value }] : [];
  });
  const reviews = review ? [review] : collection.reviews;
  const { groups, remaining } = codeGroups(reviews, sources);
  const checking = reviews.some((entry) => !progress[entry.id]);
  const unavailable = reviews.find((entry) => progress[entry.id]?.status === "unavailable");
  const nextGroup = remaining.find(({ state }) => state?.changedSinceReview) ?? remaining[0];
  const openCodeTab = () => {
    if (onCodeTab) onCodeTab();
    else if (nextGroup ?? groups[0]) openCode({ review: (nextGroup ?? groups[0]).review.id, group: (nextGroup ?? groups[0]).group.id });
  };
  const title = review?.title ?? collection.title;
  const summary = review ? review.description : collection.description;
  const documentComment = () => comment({ kind: "document", revision: snapshot.version, title });
  const rowsFor = (targets: Array<{ review: string; group: string }>) => targets.flatMap((target) => {
    const entry = collection.reviews.find((candidate) => candidate.id === target.review);
    return entry ? [{ review: entry, group: target.group }] : [];
  });
  const partGroups = review ? sources[review.id]?.sections.map((section) => section.id) ?? review.groups.map((group) => group.id) : [];
  const partRows = review ? partGroups.map((group) => ({ review, group })) : [];
  const contentsCode = review && {
    tree: partTree(review.id, partGroups, structure),
    groups: new Map(partGroups.map((group): [string, ContentsGroup] => [group, { id: group, title: groupTitle(review, group), state: referenceState({ review: review.id, group }) }])),
    onGroup: (group: string) => openCode({ review: review.id, group }),
  };
  const previous = review ? (partIndex > 0 ? collection.reviews[partIndex - 1] : collection.brief ? "feature" as const : null) : null;
  const next = review ? (partIndex < collection.reviews.length - 1 ? collection.reviews[partIndex + 1] : collection.brief ? "feature" as const : null)
    : collection.reviews[0] ?? null;
  const partLabel = (entry: Review) => `Part ${collection.reviews.findIndex((candidate) => candidate.id === entry.id) + 1}`;
  const renderBlock = (block: BriefBlock) => {
    const revision = snapshot.fingerprints[block.id];
    switch (block.kind) {
      case "markdown": return <div data-brief-text={block.id}><Markdown onReference={openLink} referenceState={linkState} marks={marksIn(block.id)}>{block.markdown}</Markdown></div>;
      case "visual": return <BriefVisual collection={collection.id} review={review?.id} block={block.id} visual={block.visual} />;
      case "question": return <BriefQuestion key={revision} block={block} revision={revision} saving={saving} onSave={save} subject={subject}
        saved={current.find((entry): entry is Extract<BriefFeedback, { kind: "answer" }> => entry.kind === "answer" && entry.block.id === block.id)} />;
      case "code": {
        const approval = current.find((entry) => entry.kind === "approval" && entry.block.id === block.id);
        const approved = !!approval;
        const callTree = block.language === "call-tree";
        return <section className="brief-code">
          {callTree
            // An approval covers every line, so none starts folded.
            ? <CallTree code={block.code} textId={block.id} heading={block.title || "Call tree"} marks={block.approval ? [[0, block.code.length]] : marksIn(block.id)} />
            : <div className="brief-code-heading"><span>{block.title || "Code excerpt"}</span><small>{block.language}</small></div>}
          {block.reference?.file && <button className="brief-code-source" onClick={() => block.reference && openCode(block.reference)}>
            {block.reference.file.path}:{block.reference.file.start}{block.reference.file.end !== block.reference.file.start ? `–${block.reference.file.end}` : ""}<ArrowRight size={13} />
          </button>}
          {!callTree && <pre data-brief-text={block.id}><HighlightedCode code={block.code} language={block.language} /></pre>}
          {(block.approval || block.reference) && <div className="brief-code-actions">
            {block.approval && <ApproveExcerpt approved={approved} saving={saving}
              replies={!!approval && (snapshot.threads[approval.id] ?? []).some((event) => event.body !== undefined)}
              onToggle={async () => { if (await save({ kind: "approve", block: block.id, revision, approved: !approved })) setNotice(approved ? "Excerpt approval removed." : "Excerpt approved. Its code group keeps its own review status."); }} />}
            {block.reference && <button className="brief-code-reference" onClick={() => block.reference && openCode(block.reference)}>Open code group <ArrowRight size={14} /><BriefGroupStatus state={referenceState(block.reference)} /></button>}
          </div>}
          {block.approval && <small className="brief-code-scope">Approval covers this exact excerpt. Mark its group reviewed separately, below or in the code.</small>}
        </section>;
      }
    }
  };
  return <><ReviewFrame eyebrow={review ? `Part ${partIndex + 1} of ${collection.reviews.length}` : "Feature overview"} title={title}
    summary={<>{summary && <Description key={readingKey} className="feature-brief-summary" text={summary} />}{pullRequests}</>}
    tabs={<BriefTabs label={review ? "Part views" : "Feature views"} current={view} code={checking ? "…" : remaining.length}
      feedback={openThreads(own)} replies={own.person}
      onBrief={() => setView("brief")} onCode={openCodeTab} onFeedback={() => setView("feedback")} />}
    rail={({ onClose, shut }) => <BriefContents collection={collection} review={review} outline={outline} active={active} counts={counts} progress={progress}
      attention={snapshot.attention} onClose={onClose} code={contentsCode && { ...contentsCode, onGroup: (group) => { shut(); contentsCode.onGroup(group); } }}
      onHeading={(heading) => { shut(); jumpHeading(heading); }}
      onFeature={() => { shut(); if (review) onFeature(); else toTop(); }}
      onReview={(id) => { shut(); if (id !== review?.id) onReview(id); else toTop(); }} />}>
      {notice && <p className="brief-notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={13} /></button></p>}
      {error && modal?.kind !== "comment" && <div className="brief-error" role="alert">{error}<button onClick={retry}>Refresh overview</button></div>}
      <div className="brief-layout">
        {view === "brief" ? <article className="brief-document" ref={text} tabIndex={-1} aria-label={`${review ? "Part" : "Feature"} overview`}
          onClick={(event) => {
            // Clicks in portals, such as the visual viewer, bubble here through React.
            if (!event.currentTarget.contains(event.target as Node)) return;
            if (event.target instanceof Element && event.target.closest("button,a,input,textarea,label")) return;
            if (window.getSelection()?.toString().trim()) return;
            const ids = annotations.notesAt(event.clientX, event.clientY);
            if (ids.length) setModal({ kind: "notes", ids });
          }}>
          <div className="brief-document-tools"><button onClick={selectedComment}>Select text to comment <kbd>⌥⇧M</kbd></button><button onClick={documentComment}><MessageSquare size={13} />Comment on the whole overview</button></div>
          {snapshot.brief.blocks.map((block) => <React.Fragment key={block.id}>
            <section className={`brief-block brief-block-${block.kind}`} id={`brief-block-${block.id}`} tabIndex={-1}>
              <button className="brief-block-comment" aria-label={`Comment on ${blockTitle(block)}`} title="Comment on this section" onClick={() => comment({ kind: "block", block: block.id, revision: snapshot.fingerprints[block.id], title: blockTitle(block) })}><MessageSquare size={14} /></button>
              {renderBlock(block)}
            </section>
            {sections.filter((section) => section.end === block.id && section.groups.length > 0).map((section) => {
              const id = section.heading?.key ?? section.start;
              return <BriefCodeGroups key={id} id={`section:${id}`} title={section.heading ? `Code for “${section.heading.text}”` : "Code for this section"}
                collection={collection} current={review?.id} rows={rowsFor(section.groups)} sources={sources} marking={marking}
                stateOf={referenceState} onOpen={openCode} onMark={onMark} />;
            })}
          </React.Fragment>)}
          {review && partRows.length > 0 && <BriefCodeGroups id={`part:${review.id}`} title={`Every code group in part ${partIndex + 1}`}
            collection={collection} current={review.id} rows={partRows} sources={sources} marking={marking}
            stateOf={referenceState} onOpen={openCode} onMark={onMark} />}
          {(previous || next) && <nav className="brief-pager" aria-label="Parts">
            {previous ? <button className="brief-pager-link" onClick={() => previous === "feature" ? onFeature() : onReview(previous.id)}>
              <ArrowLeft size={15} /><span><small>{previous === "feature" ? "Feature overview" : `Previous · ${partLabel(previous)}`}</small>
                <strong>{previous === "feature" ? collection.title : previous.title}</strong></span></button> : <span />}
            {next && <button className="brief-pager-link next" onClick={() => next === "feature" ? onFeature() : onReview(next.id)}>
              <span><small>{next === "feature" ? "Back to the feature overview" : `Next · ${partLabel(next)}`}</small>
                <strong>{next === "feature" ? collection.title : next.title}</strong>
                {next !== "feature" && <PartStatus progress={progress[next.id]} />}</span><ArrowRight size={15} /></button>}
          </nav>}
        </article> : <BriefFeedbackView ref={feedbackView} collection={collection.id} review={review && { id: review.id, title: review.title }} snapshot={snapshot}
          saving={saving} send={send} onEdit={edit} onLocate={locate} onComment={documentComment}
          parts={review ? [] : collection.reviews.flatMap((entry) => {
            const brief = snapshot.attention?.reviews[entry.id]?.threads, code = snapshot.attention?.code?.[entry.id];
            const open = openThreads(brief) + openThreads(code);
            return open ? [{ id: entry.id, title: `${partLabel(entry)} · ${entry.title}`, open,
              replies: (brief?.person ?? 0) + (code?.person ?? 0), agent: (brief?.agent ?? 0) + (code?.agent ?? 0) }] : [];
          })}
          code={review && codeComments ? {
            comments: codeComments.comments, threads: codeComments.threads, loaded: codeComments.loaded, saving: codeComments.saving, error: codeComments.error, groupTitle: groupTitleIn(review),
            send: (comment) => (command) => codeComments.save({ ...command, entry: comment.id }),
            // Not through openCode: the comment's group may be gone while its file shows in another group.
            onShow: (comment) => onCode({ review: review.id, group: comment.group, comment: { line: comment.line },
              file: { path: comment.path, start: comment.line?.number ?? 1, end: comment.line?.number ?? 1 } }, "feedback"),
            onRemove: (comment) => codeComments.save({ kind: "delete", id: comment.id }),
          } : undefined}
          onPart={(id) => onReview(id, undefined, "feedback")} />}
        <aside className="brief-attention" aria-label={`${review ? "Part" : "Feature"} attention and progress`}><h2>Needs your attention</h2>
          <div className="brief-attention-items">
            {replies.length > 0 && <button className="brief-attention-item agent-reply" onClick={() => showFeedback("person")}>
              <span>Your agent replied{replies.length > 1 ? ` · ${replies.length}` : ""}</span><strong>{clip(replies[0])}</strong>
              <small>Reply or resolve on the Feedback tab.</small></button>}
            {partReplies.map(({ review: entry, count }) => <button className="brief-attention-item agent-reply" key={`replies/${entry.id}`}
              onClick={() => onReview(entry.id, undefined, "replies")}>
              <span>Your agent replied · {partLabel(entry)}</span><strong>{entry.title}</strong>
              <small>{count === 1 ? "One reply" : `${count} replies`} {entry.brief ? "on its Feedback tab" : "in its code"}.</small></button>)}
            {unanswered.map((block, index) => <button className="brief-attention-item" key={block.id} onClick={() => jump(block.id)}>
              <span>{unanswered.length > 1 ? `Answer requested · ${index + 1} of ${unanswered.length}` : "Answer requested"}</span><strong>{block.question}</strong>
            </button>)}
            {unapproved.length > 0 && <button className="brief-attention-item" onClick={() => jump(unapproved[0].id)}><span>Approval requested{unapproved.length > 1 ? ` · ${unapproved.length}` : ""}</span><strong>{blockTitle(unapproved[0])}</strong><small>Inspect the excerpt above.</small></button>}
            {partAttention.flatMap((entry) => [
              ...entry.questions.map((question) => <button className="brief-attention-item" key={`${entry.review.id}/${question.block}`} onClick={() => onReview(entry.review.id, question.block)}>
                <span>Answer requested · {partLabel(entry.review)}</span><strong>{question.question}</strong><small>{entry.review.title}</small>
              </button>),
              ...entry.approvals.map((approval) => <button className="brief-attention-item" key={`${entry.review.id}/${approval.block}`} onClick={() => onReview(entry.review.id, approval.block)}>
                <span>Approval requested · {partLabel(entry.review)}</span><strong>{approval.title}</strong><small>{entry.review.title}</small>
              </button>),
            ])}
            {checking ? <p className="brief-attention-status"><LoaderCircle size={13} className="spin" />Checking code review status…</p>
              : unavailable ? <p className="brief-attention-status" role="alert">{unavailable.title}: {progress[unavailable.id]?.error || "Couldn’t check this part’s code."}</p>
              : nextGroup ? <button className="brief-attention-item" onClick={() => openCode({ review: nextGroup.review.id, group: nextGroup.group.id })}>
                <span>{nextGroup.state?.changedSinceReview ? "Changed since review" : "Next code group"}{!review ? ` · ${partLabel(nextGroup.review)}` : ""}</span>
                <strong>{groupTitle(nextGroup.review, nextGroup.group.id)}</strong>
                <small>{remaining.length === 1 ? "The last group to review." : `${remaining.length} groups left${review ? " in this part" : ""}.`}</small></button>
              : <p className="brief-resolved"><CheckCheck size={14} />Every code group reviewed</p>}
            {!unanswered.length && !unapproved.length && !partAttention.some((entry) => entry.questions.length || entry.approvals.length)
              && <p className="brief-resolved"><CheckCheck size={14} />No questions left</p>}
          </div>
          <div className="brief-code-progress"><div><span>Code groups reviewed</span><span>{checking ? "…" : `${groups.length - remaining.length} / ${groups.length}`}</span></div><progress aria-label="Named code groups reviewed" max={groups.length || 1} value={checking ? undefined : groups.length - remaining.length} /></div>
          {notes.length > 0 && <section className="brief-recent-notes"><h3>Your comments <span className="pill">{openNotes.length}</span></h3>{openNotes.map((entry) => <button className="brief-note-preview" key={entry.id} onClick={() => setModal({ kind: "notes", ids: [entry.id] })}>
            <q>{anchorQuote(entry.anchor) || feedbackTitle(entry)}</q><span>{plainText(entry.body) || `${entry.attachments.length} attached ${entry.attachments.length === 1 ? "image" : "images"}`}</span>{!feedbackCurrent(entry, snapshot) && <small>Earlier revision</small>}
            {threadState(entry, snapshot.threads[entry.id]).turn === "person" && <small className="brief-note-replied">Your agent replied</small>}
          </button>)}
            {notes.length > openNotes.length && <button className="brief-note-resolved" onClick={() => showFeedback("resolved")}>{notes.length - openNotes.length} resolved</button>}</section>}
          <p className="brief-attention-note">Answers, approvals, and comments stay with this {subject}. Reading doesn’t mark code reviewed; Mark reviewed does, the same as in the code.</p>
        </aside>
      </div>
    </ReviewFrame>
    {view === "brief" && annotations.selection && !modal && createPortal(<div className="brief-selection-tools" role="toolbar" aria-label="Selected passage" style={{ left: annotations.selection.x, top: annotations.selection.y }} onPointerDown={(event) => event.preventDefault()}>
      <button onClick={selectedComment}><MessageSquare size={14} /> Comment on selection</button><button aria-label="Dismiss selection comment" onClick={() => { window.getSelection()?.removeAllRanges(); annotations.clearSelection(); }}><X size={14} /></button>
    </div>, document.body)}
    {modal?.kind === "comment" && <BriefCommentEditor key={modal.id} collection={collection.id} review={review?.id} draft={modal} saving={saving} error={error} onClose={() => setModal(null)} onSave={async (body, attachments) => {
      const saved = await save({ kind: "comment", id: modal.id, anchor: modal.anchor, body, attachments });
      if (saved) { setModal((current) => current?.kind === "comment" && current.id === modal.id ? null : current); setNotice("Comment saved with its passage and revision."); }
      return saved;
    }} />}
    {modal?.kind === "notes" && <BriefDialog title={modal.ids.length > 1 ? "Your comments" : "Your comment"} onClose={() => setModal(null)}>
      <div className="brief-note-thread">{snapshot.feedback.filter((entry): entry is Comment => entry.kind === "comment" && modal.ids.includes(entry.id)).map((entry) =>
        <BriefItem key={entry.id} entry={entry} snapshot={snapshot} events={snapshot.threads[entry.id] ?? []} scope={`${collection.id}/${review?.id ?? ""}`} saving={saving}
          send={(command) => send({ ...command, entry: entry.id })} onRemove={() => send({ kind: "delete", id: entry.id })}
          onEdit={edit} collection={collection.id} review={review?.id} />)}</div>
    </BriefDialog>}
  </>;
}

const clip = (text: string) => text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;

// Removing an approval deletes its thread, so ask first once the agent has replied to it.
function ApproveExcerpt({ approved, replies, saving, onToggle }: { approved: boolean; replies: boolean; saving: boolean; onToggle: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (confirming || saving || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [confirming, saving]);
  const close = () => { refocus.current = true; setConfirming(false); };
  if (confirming) return <div className="brief-approve-confirm" role="group" aria-label="Remove approval">
    <span>Remove this approval and its replies? Your agent won’t see them.</span>
    <button disabled={saving} onClick={() => { close(); void onToggle(); }}>Remove</button>
    <button autoFocus onClick={close}>Keep</button>
  </div>;
  return <button ref={button} className={`brief-approve${approved ? " approved" : ""}`} aria-pressed={approved} disabled={saving}
    onClick={() => { if (approved && replies) setConfirming(true); else void onToggle(); }}>
    {approved && <Check size={14} />}{approved ? "Excerpt approved" : "Approve this excerpt"}</button>;
}

function readingPlace(article: HTMLElement | null): ReadingPlace | undefined {
  const blocks = Array.from(article?.querySelectorAll<HTMLElement>(":scope > .brief-block") ?? []);
  const block = blocks.find((element) => element.getBoundingClientRect().bottom > 0) ?? blocks[blocks.length - 1];
  return block && { block: block.id, offset: -block.getBoundingClientRect().top };
}

function restoreReadingPlace(reading: ReadingPlace) {
  const block = document.getElementById(reading.block);
  window.scrollTo(0, block ? window.scrollY + block.getBoundingClientRect().top + reading.offset : 0);
}

function holdPosition(article: HTMLElement | null, position: () => void) {
  position();
  if (!article) return () => {};
  // Visuals finish loading after this, and call trees open the steps comments are on, resizing the blocks around the place, so it is set again until the reader moves.
  const until = performance.now() + 3000;
  const settle = () => { if (performance.now() < until) position(); };
  const resized = new ResizeObserver(settle);
  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const release = () => {
    article.removeEventListener("load", settle, true);
    resized.disconnect();
    inputs.forEach((name) => window.removeEventListener(name, release));
  };
  article.addEventListener("load", settle, true);
  resized.observe(article);
  inputs.forEach((name) => window.addEventListener(name, release, { passive: true }));
  return release;
}
