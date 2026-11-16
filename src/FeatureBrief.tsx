import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ArrowLeft, ArrowRight, Check, CheckCheck, ListTree, LoaderCircle, MessageSquare, X } from "lucide-react";
import type { Collection, ProgressSource, Review, ReviewProgress } from "./review-types";
import type { BriefAnchor, BriefBlock, BriefFeedback, BriefReference } from "./brief-types";
import { anchorQuote, blockTitle, feedbackBody, feedbackCurrent, feedbackTitle, groupTitleIn } from "./brief-feedback";
import { captureBriefSelection, rangeForSegment, textOffset } from "./brief-selection";
import type { BriefState } from "./useBrief";
import type { CodeComments } from "./useCodeComments";
import type { CodeJump } from "./code-comments";
import { useBriefAnnotations } from "./useBriefAnnotations";
import { BriefDialog } from "./BriefDialog";
import { BriefFeedbackView } from "./BriefFeedbackView";
import { BriefQuestion } from "./BriefQuestion";
import { BriefTabs } from "./BriefTabs";
import { BriefVisual } from "./BriefVisual";
import { Markdown, type BriefLink } from "./Markdown";
import { HighlightedCode } from "./HighlightedCode";
import { BriefCommentEditor, type BriefCommentDraft } from "./BriefCommentEditor";
import { CommentImages, savedCommentImages } from "./CommentImages";
import { BriefGroupStatus, groupReadState, type GroupReadState } from "./BriefGroupStatus";
import { BriefContents, PartStatus, type HeadingCounts } from "./BriefContents";
import { BriefCodeGroups, groupTitle, type MarkGroups } from "./BriefCodeGroups";
import { briefStructure, type BriefStructure, type OutlineHeading } from "./brief-outline";
import { codeGroups } from "./progress";
import { Description } from "./Description";
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

export function FeatureBrief({ collection, review, brief, progress, sources, marking, initialView = "brief", initialBlock, onJumped, onCode, onReview, onFeature, onCodeTab, onMark, codeComments }: {
  collection: Collection; review?: Review; brief: BriefState; progress: Record<string, ReviewProgress>; sources: Record<string, ProgressSource>;
  marking: string; initialView?: View; initialBlock?: string; onJumped?: () => void; onCode: (reference: CodeJump, view: View) => void;
  onReview: (review: string, block?: string, view?: "feedback") => void; onFeature: () => void; onCodeTab?: () => void; onMark: MarkGroups;
  codeComments?: CodeComments;
}) {
  const { snapshot, error, saving, save, retry } = brief;
  const [view, setView] = useState<View>(initialView);
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState("");
  const [contentsOpen, setContentsOpen] = useState(false);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const text = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const placed = useRef(false);
  const initialTarget = useRef(initialBlock ?? "");
  const annotations = useBriefAnnotations(text, snapshot, view === "brief", !!modal);
  const structure = useMemo(() => snapshot ? briefStructure(snapshot.brief) : emptyStructure, [snapshot?.version]);
  const { outline, sections } = structure;
  const subject = review ? "part" : "feature";
  const readingKey = review ? `${collection.id}/${review.id}` : collection.id;
  const partIndex = review ? collection.reviews.findIndex((entry) => entry.id === review.id) : -1;
  const edit = (entry: Comment) => setModal({ kind: "comment", id: entry.id, anchor: entry.anchor, body: entry.body, attachments: entry.attachments });
  const comment = (anchor: BriefAnchor) => {
    annotations.clearSelection();
    setModal({ kind: "comment", id: crypto.randomUUID(), anchor, body: "", attachments: [] });
  };
  const selectedComment = () => {
    if (!snapshot || !text.current) return;
    const anchor = annotations.selection?.anchor ?? captureBriefSelection(text.current, snapshot);
    if (anchor) comment(anchor); else setNotice("Select a passage, then add your comment.");
  };
  // The page stays inert until the closed drawer renders, and focus() on an inert element silently does nothing.
  const shut = () => { if (contentsOpen) flushSync(() => setContentsOpen(false)); };
  const closeContents = () => { shut(); toggle.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === "KeyM" && !modal) { event.preventDefault(); selectedComment(); }
      if (!contentsOpen) return;
      if (event.key === "Escape") closeContents();
      if (event.key === "Tab") trapFocus(event);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [snapshot, modal, annotations.selection, contentsOpen]);
  useEffect(() => {
    const rail = contentsOpen ? document.getElementById("brief-contents") : null;
    if (!rail) return;
    const item = ["[aria-current=location]", "[aria-current=page]", "button"].map((selector) => rail.querySelector<HTMLElement>(selector)).find(Boolean);
    item?.focus();
    const wide = window.matchMedia("(min-width: 1180px)");
    const change = () => { if (wide.matches) setContentsOpen(false); };
    wide.addEventListener("change", change);
    return () => wide.removeEventListener("change", change);
  }, [contentsOpen]);
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
    shut();
    reveal(positionOf(heading.key));
    chosen.current = heading.key;
    setActive(heading.key);
  };
  const toTop = () => { shut(); reveal(() => { window.scrollTo(0, 0); text.current?.focus({ preventScroll: true }); }); };
  const locate = (entry: BriefFeedback) => {
    if (entry.kind !== "comment" || !snapshot) return;
    const anchor = entry.anchor;
    if (anchor.kind === "block") { jump(anchor.block); return; }
    if (anchor.kind !== "selection") return;
    reveal(() => {
      if (!text.current) return;
      const range = rangeForSegment(text.current, anchor.segments[0]);
      const node = range?.startContainer.parentElement;
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
  useEffect(() => {
    if (view !== "brief" || !outline.length) { setActive(""); return; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A heading near the end can't reach the top, so the one the reader picked stays current while it's on screen.
        const picked = chosen.current && outline.find((heading) => heading.key === chosen.current);
        const pickedTop = picked ? headingElement(picked)?.getBoundingClientRect().top : undefined;
        if (pickedTop !== undefined && pickedTop >= 0 && pickedTop < window.innerHeight) { setActive(chosen.current); return; }
        chosen.current = "";
        const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        let current = outline[0].key;
        for (const heading of outline) {
          const top = headingElement(heading)?.getBoundingClientRect().top;
          if (top === undefined) continue;
          if (top <= 140 || (atEnd && top < window.innerHeight - 80)) current = heading.key;
          else break;
        }
        setActive(current);
      });
    };
    const release = () => { chosen.current = ""; };
    const inputs = ["wheel", "touchmove", "keydown"] as const;
    update();
    inputs.forEach((name) => window.addEventListener(name, release, { passive: true }));
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      inputs.forEach((name) => window.removeEventListener(name, release));
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [view, outline]);
  // Selections store offsets into a block's text, so each heading's offset there says which heading a comment falls under.
  useLayoutEffect(() => {
    if (view !== "brief") return;
    const next: Record<string, number> = {};
    for (const heading of outline) {
      const element = headingElement(heading);
      const root = element?.closest<HTMLElement>("[data-brief-text]");
      if (element && root) next[heading.key] = textOffset(root, element, 0);
    }
    setOffsets((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
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
  const counts: HeadingCounts = {};
  const ownerAt = (block: string, offset?: number) => {
    let owner = structure.owners.get(block);
    for (const heading of offset === undefined ? [] : structure.headings.get(block) ?? []) {
      const at = offsets[heading.key];
      if (at !== undefined && at <= offset!) owner = heading.key;
    }
    return owner;
  };
  const count = (owner: string | undefined, field: "comments" | "questions") => {
    if (!owner) return;
    counts[owner] ??= { comments: 0, questions: 0 };
    counts[owner][field] += 1;
  };
  for (const entry of notes) {
    if (!feedbackCurrent(entry, snapshot)) continue;
    if (entry.anchor.kind === "block") count(ownerAt(entry.anchor.block), "comments");
    else if (entry.anchor.kind === "selection") count(ownerAt(entry.anchor.segments[0].block, entry.anchor.segments[0].start), "comments");
  }
  for (const block of unanswered) count(ownerAt(block.id), "questions");
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
  const partRows = review
    ? (sources[review.id]?.sections.map((section) => section.id) ?? review.groups.map((group) => group.id)).map((group) => ({ review, group })) : [];
  const previous = review ? (partIndex > 0 ? collection.reviews[partIndex - 1] : collection.brief ? "feature" as const : null) : null;
  const next = review ? (partIndex < collection.reviews.length - 1 ? collection.reviews[partIndex + 1] : collection.brief ? "feature" as const : null)
    : collection.reviews[0] ?? null;
  const partLabel = (entry: Review) => `Part ${collection.reviews.findIndex((candidate) => candidate.id === entry.id) + 1}`;
  const renderBlock = (block: BriefBlock) => {
    const revision = snapshot.fingerprints[block.id];
    switch (block.kind) {
      case "markdown": return <div data-brief-text={block.id}><Markdown onReference={openLink} referenceState={linkState}>{block.markdown}</Markdown></div>;
      case "visual": return <BriefVisual collection={collection.id} review={review?.id} block={block.id} visual={block.visual} />;
      case "question": return <BriefQuestion key={revision} block={block} revision={revision} saving={saving} onSave={save} subject={subject}
        saved={current.find((entry): entry is Extract<BriefFeedback, { kind: "answer" }> => entry.kind === "answer" && entry.block.id === block.id)} />;
      case "code": {
        const approved = current.some((entry) => entry.kind === "approval" && entry.block.id === block.id);
        return <section className="brief-code"><div className="brief-code-heading"><span>{block.title || "Code excerpt"}</span><small>{block.language}</small></div>
          {block.reference?.file && <button className="brief-code-source" onClick={() => block.reference && openCode(block.reference)}>
            {block.reference.file.path}:{block.reference.file.start}{block.reference.file.end !== block.reference.file.start ? `–${block.reference.file.end}` : ""}<ArrowRight size={13} />
          </button>}
          <pre data-brief-text={block.id}><HighlightedCode code={block.code} language={block.language} /></pre>
          {(block.approval || block.reference) && <div className="brief-code-actions">
            {block.approval && <button className={`brief-approve${approved ? " approved" : ""}`} aria-pressed={approved} disabled={saving}
              onClick={async () => { if (await save({ kind: "approve", block: block.id, revision, approved: !approved })) setNotice(approved ? "Excerpt approval removed." : "Excerpt approved. Its code group keeps its own review status."); }}>
              {approved && <Check size={14} />}{approved ? "Excerpt approved" : "Approve this excerpt"}</button>}
            {block.reference && <button className="brief-code-reference" onClick={() => block.reference && openCode(block.reference)}>Open code group <ArrowRight size={14} /><BriefGroupStatus state={referenceState(block.reference)} /></button>}
          </div>}
          {block.approval && <small className="brief-code-scope">Approval covers this exact excerpt. Mark its group reviewed separately, below or in the code.</small>}
        </section>;
      }
    }
  };
  return <div className={`feature-brief${contentsOpen ? " contents-open" : ""}`}>
    <BriefContents collection={collection} review={review} outline={outline} active={active} counts={counts} progress={progress}
      attention={snapshot.attention} onHeading={jumpHeading} onClose={contentsOpen ? closeContents : undefined}
      onFeature={() => { if (review) onFeature(); else toTop(); }}
      onReview={(id) => { if (id !== review?.id) onReview(id); else toTop(); }} />
    {contentsOpen && <div className="brief-contents-backdrop" aria-hidden="true" onClick={closeContents} />}
    <div className="brief-body" inert={contentsOpen || undefined}>
      <header className="feature-brief-heading">
        <button className="brief-contents-toggle" ref={toggle} aria-expanded={contentsOpen} aria-controls="brief-contents" onClick={() => setContentsOpen((value) => !value)}><ListTree size={15} />Contents</button>
        <div className="brief-eyebrow">{review ? `Part ${partIndex + 1} of ${collection.reviews.length}` : "Feature overview"}</div>
        <h1>{title}</h1>
        {summary && <Description key={readingKey} className="feature-brief-summary" text={summary} />}
        <BriefTabs label={review ? "Part views" : "Feature views"} current={view} code={checking ? "…" : remaining.length}
          feedback={snapshot.feedback.length + (codeComments?.comments.length ?? 0)}
          onBrief={() => setView("brief")} onCode={openCodeTab} onFeedback={() => setView("feedback")} />
      </header>
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
        </article> : <BriefFeedbackView collection={collection.id} title={collection.title} review={review && { id: review.id, title: review.title }} snapshot={snapshot}
          saving={saving} onEdit={edit} onDelete={(id) => { void save({ kind: "delete", id }); }} onLocate={locate} onComment={documentComment}
          parts={review ? [] : collection.reviews.flatMap((entry) => {
            const count = (snapshot.attention?.reviews[entry.id]?.feedback ?? 0) + (snapshot.attention?.codeComments?.[entry.id] ?? 0);
            return count ? [{ id: entry.id, title: `${partLabel(entry)} · ${entry.title}`, count }] : [];
          })}
          code={review && codeComments ? {
            comments: codeComments.comments, loaded: codeComments.loaded, saving: codeComments.saving, error: codeComments.error, groupTitle: groupTitleIn(review),
            // Not through openCode: the comment's group may be gone while its file shows in another group.
            onShow: (comment) => onCode({ review: review.id, group: comment.group, comment: { line: comment.line },
              file: { path: comment.path, start: comment.line?.number ?? 1, end: comment.line?.number ?? 1 } }, "feedback"),
            onRemove: (comment) => codeComments.save({ kind: "delete", id: comment.id }),
          } : undefined}
          onPart={(id) => onReview(id, undefined, "feedback")} />}
        <aside className="brief-attention" aria-label={`${review ? "Part" : "Feature"} attention and progress`}><h2>Needs your attention</h2>
          <div className="brief-attention-items">
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
          {notes.length > 0 && <section className="brief-recent-notes"><h3>Your comments <span className="pill">{notes.length}</span></h3>{notes.map((entry) => <button className="brief-note-preview" key={entry.id} onClick={() => edit(entry)}>
            <q>{anchorQuote(entry.anchor) || feedbackTitle(entry)}</q><span>{entry.body || `${entry.attachments.length} attached ${entry.attachments.length === 1 ? "image" : "images"}`}</span>{!feedbackCurrent(entry, snapshot) && <small>Earlier revision</small>}
          </button>)}</section>}
          <p className="brief-attention-note">Answers, approvals, and comments stay with this {subject}. Reading doesn’t mark code reviewed; Mark reviewed does, the same as in the code.</p>
        </aside>
      </div>
    </div>
    {view === "brief" && annotations.selection && !modal && createPortal(<div className="brief-selection-tools" role="toolbar" aria-label="Selected passage" style={{ left: annotations.selection.x, top: annotations.selection.y }} onPointerDown={(event) => event.preventDefault()}>
      <button onClick={selectedComment}><MessageSquare size={14} /> Comment on selection</button><button aria-label="Dismiss selection comment" onClick={() => { window.getSelection()?.removeAllRanges(); annotations.clearSelection(); }}><X size={14} /></button>
    </div>, document.body)}
    {modal?.kind === "comment" && <BriefCommentEditor key={modal.id} collection={collection.id} review={review?.id} draft={modal} saving={saving} error={error} onClose={() => setModal(null)} onSave={async (body, attachments) => {
      const saved = await save({ kind: "comment", id: modal.id, anchor: modal.anchor, body, attachments });
      if (saved) { setModal((current) => current?.kind === "comment" && current.id === modal.id ? null : current); setNotice("Comment saved with its passage and revision."); }
      return saved;
    }} />}
    {modal?.kind === "notes" && <BriefDialog title="Your comment" onClose={() => setModal(null)}>
      {snapshot.feedback.filter((entry): entry is Comment => entry.kind === "comment" && modal.ids.includes(entry.id)).map((entry) => <section className="brief-note-detail" key={entry.id}>
        {!feedbackCurrent(entry, snapshot) && <p className="brief-earlier">This comment belongs to an earlier revision. Its original quote is preserved.</p>}
        {anchorQuote(entry.anchor) && <blockquote className="brief-quote">{anchorQuote(entry.anchor)}</blockquote>}<p>{feedbackBody(entry)}</p>
        <CommentImages images={savedCommentImages(collection.id, entry.id, entry.attachments, review?.id)} />
        <div className="brief-feedback-actions"><button onClick={() => edit(entry)}>Edit comment</button><button disabled={saving} onClick={async () => { if (await save({ kind: "delete", id: entry.id })) setModal(null); }}>Remove</button></div>
      </section>)}
    </BriefDialog>}
  </div>;
}

function trapFocus(event: KeyboardEvent) {
  const rail = document.getElementById("brief-contents");
  const items = [...rail?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []];
  if (!rail || !items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = rail.contains(document.activeElement);
  if (!inside || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
  // Visuals finish loading after this and resize the blocks around the place, so it is set again until the reader moves.
  const until = performance.now() + 3000;
  const settle = () => { if (performance.now() < until) position(); };
  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const release = () => {
    article.removeEventListener("load", settle, true);
    inputs.forEach((name) => window.removeEventListener(name, release));
  };
  article.addEventListener("load", settle, true);
  inputs.forEach((name) => window.addEventListener(name, release, { passive: true }));
  return release;
}
