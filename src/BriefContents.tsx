import React, { useLayoutEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, BookOpen, CheckCheck, Circle, CircleDashed, CircleHelp, Code2, LoaderCircle, MessageSquare, Minus, RotateCcw, X } from "lucide-react";
import type { Collection, Review, ReviewProgress } from "./review-types";
import type { BriefSegment, BriefSnapshot, CollectionAttention } from "./brief-types";
import type { BriefStructure, OutlineHeading } from "./brief-outline";
import { feedbackCurrent } from "./brief-feedback";
import { threadState } from "./threads";
import { BriefGroupStatus, type GroupReadState } from "./BriefGroupStatus";
import type { PartTree } from "./part-tree";

export type HeadingCounts = Record<string, { comments: number; questions: number }>;
export type ContentsGroup = { id: string; title: string; state: GroupReadState; files?: ReactNode };
export type ContentsCode = { tree: PartTree; groups: Map<string, ContentsGroup>; current?: string; onGroup: (id: string) => void };

const statusIcons = { reviewed: CheckCheck, partial: CircleDashed, changed: RotateCcw, attention: AlertTriangle,
  unreviewed: Circle, empty: Minus, unavailable: CircleHelp } as const;
const statusWords = { reviewed: "Reviewed", partial: "Partly reviewed", changed: "Changed since review", attention: "Needs attention",
  unreviewed: "Not reviewed", empty: "No changes", unavailable: "Couldn’t check" } as const;

// Each tab mounts its own rail, so its scroll is kept here to stay put when the reader switches tabs.
const railScroll = new Map<string, number>();

// A selection keeps its block's rendered text, where a heading is a line of its own. Without the rendered overview's
// offsets, a heading's offset is the line that reads the same after `repeat` earlier ones.
function lineOffsets(text: string, headings: OutlineHeading[]) {
  const offsets: Record<string, number> = {};
  for (const heading of headings) {
    let seen = 0;
    for (let at = text.indexOf(heading.line); at >= 0; at = text.indexOf(heading.line, at + 1)) {
      const end = at + heading.line.length;
      if ((at > 0 && text[at - 1] !== "\n") || (end < text.length && text[end] !== "\n")) continue;
      if (seen++ === heading.repeat) { offsets[heading.key] = at; break; }
    }
  }
  return offsets;
}

export function headingCounts(snapshot: BriefSnapshot, structure: BriefStructure, rendered?: Record<string, number>): HeadingCounts {
  const counts: HeadingCounts = {};
  const ownerAt = (block: string, segment?: BriefSegment) => {
    let owner = structure.owners.get(block);
    const within = structure.headings.get(block) ?? [];
    if (!segment || !within.length) return owner;
    const offsets = rendered ?? lineOffsets(segment.text, within);
    for (const heading of within) {
      const at = offsets[heading.key];
      if (at !== undefined && at <= segment.start) owner = heading.key;
    }
    return owner;
  };
  const count = (owner: string | undefined, field: "comments" | "questions") => {
    if (!owner) return;
    counts[owner] ??= { comments: 0, questions: 0 };
    counts[owner][field] += 1;
  };
  for (const entry of snapshot.feedback) {
    if (entry.kind !== "comment" || !feedbackCurrent(entry, snapshot) || threadState(entry, snapshot.threads[entry.id]).turn === "resolved") continue;
    if (entry.anchor.kind === "block") count(ownerAt(entry.anchor.block), "comments");
    else if (entry.anchor.kind === "selection") count(ownerAt(entry.anchor.segments[0].block, entry.anchor.segments[0]), "comments");
  }
  const answered = new Set(snapshot.feedback.flatMap((entry) => entry.kind === "answer" && feedbackCurrent(entry, snapshot) ? [entry.block.id] : []));
  for (const block of snapshot.brief.blocks) if (block.kind === "question" && !answered.has(block.id)) count(ownerAt(block.id), "questions");
  return counts;
}

export function PartStatus({ progress }: { progress?: ReviewProgress }) {
  if (!progress) return <span className="part-status status-checking" title="Checking review status"><LoaderCircle size={12} className="spin" aria-hidden="true" /><span className="sr-only">Checking</span></span>;
  const Icon = statusIcons[progress.status];
  const count = progress.status === "empty" || progress.status === "unavailable" ? "" : `${progress.reviewedGroups}/${progress.totalGroups}`;
  return <span className={`part-status status-${progress.status}`} title={progress.error || `${statusWords[progress.status]}${count ? ` · ${count} groups` : ""}`}>
    <Icon size={12} aria-hidden="true" /><span className="sr-only">{statusWords[progress.status]}</span>{count && <span>{count}</span>}
  </span>;
}

function Groups({ ids, code }: { ids: string[]; code: ContentsCode }) {
  const rows = ids.flatMap((id) => code.groups.get(id) ?? []);
  if (!rows.length) return null;
  return <ul className="brief-contents-groups">
    {rows.map((group) => <li key={group.id}>
      <button data-group={group.id} aria-current={code.current === group.id ? "location" : undefined} onClick={() => code.onGroup(group.id)}>
        <BriefGroupStatus state={group.state} /><span>{group.title}</span>
      </button>
      {group.files}
    </li>)}
  </ul>;
}

function Headings({ outline, active, counts, code, onHeading }: {
  outline: OutlineHeading[]; active: string; counts: HeadingCounts; code?: ContentsCode; onHeading: (heading: OutlineHeading) => void;
}) {
  if (!outline.length && !code?.tree.lead.length) return null;
  return <ol className="brief-contents-headings">
    {code && code.tree.lead.length > 0 && <li className="brief-contents-lead"><Groups ids={code.tree.lead} code={code} /></li>}
    {outline.map((heading) => {
      const count = counts[heading.key];
      return <li key={heading.key} className={`level-${heading.level}`}>
        <button aria-current={active === heading.key ? "location" : undefined} onClick={() => onHeading(heading)}>
          <span>{heading.text}</span>
          {!!count?.questions && <span className="contents-question" title={`${count.questions} unanswered ${count.questions === 1 ? "question" : "questions"}`}>?</span>}
          {!!count?.comments && <span className="contents-count" title={`${count.comments} ${count.comments === 1 ? "comment" : "comments"}`}><MessageSquare size={10} aria-hidden="true" />{count.comments}</span>}
        </button>
        {code && <Groups ids={code.tree.headings.get(heading.key) ?? []} code={code} />}
      </li>;
    })}
    {code && code.tree.other.length > 0 && <li className="brief-contents-other"><span>Other code</span><Groups ids={code.tree.other} code={code} /></li>}
  </ol>;
}

export function BriefContents({ collection, review, outline, active, counts, progress, attention, code, onHeading, onFeature, onReview, onClose }: {
  collection: Collection; review?: Review; outline: OutlineHeading[]; active: string; counts: HeadingCounts;
  progress: Record<string, ReviewProgress>; attention?: CollectionAttention; code?: ContentsCode;
  onHeading: (heading: OutlineHeading) => void; onFeature: () => void; onReview: (id: string) => void; onClose?: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const reveal = (row: HTMLElement | null | undefined, margin: number) => {
    const container = list.current;
    if (!container || !row) return;
    const top = row.offsetTop - container.offsetTop;
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - margin) container.scrollTop = Math.max(0, top - 48);
  };
  useLayoutEffect(() => {
    const saved = railScroll.get(collection.id);
    if (saved !== undefined && list.current) list.current.scrollTop = saved;
  }, []);
  useLayoutEffect(() => reveal(list.current?.querySelector<HTMLElement>("[aria-current=page]"), 60), [review?.id]);
  // The group being read opens to its files, so they need room under it.
  useLayoutEffect(() => {
    if (code?.current) reveal(list.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(code.current)}"]`), 120);
  }, [code?.current]);
  const loaded = collection.reviews.filter((entry) => progress[entry.id]);
  const reviewedGroups = loaded.reduce((sum, entry) => sum + progress[entry.id].reviewedGroups, 0);
  const totalGroups = loaded.reduce((sum, entry) => sum + progress[entry.id].totalGroups, 0);
  const featureQuestions = attention?.feature?.questions.length ?? 0;
  return <nav className="brief-contents" id="brief-contents" aria-label="Contents">
    <div className="brief-contents-scroll" ref={list} onScroll={(event) => railScroll.set(collection.id, event.currentTarget.scrollTop)}>
      <div className="brief-contents-header"><h2>Contents</h2>
        {onClose && <button className="brief-contents-close" aria-label="Close contents" onClick={onClose}><X size={15} /></button>}</div>
      {collection.brief && <div className={`brief-chapter feature-chapter${review ? "" : " current"}`}>
        <button className="brief-chapter-button" aria-current={review ? undefined : "page"} onClick={onFeature}>
          <BookOpen size={14} aria-hidden="true" /><span className="brief-chapter-title">{collection.title}</span>
          {!!featureQuestions && review && <span className="contents-question" title={`${featureQuestions} unanswered in the feature overview`}>?</span>}
        </button>
        {!review && <Headings outline={outline} active={active} counts={counts} onHeading={onHeading} />}
      </div>}
      <div className="brief-contents-parts">
        <span>{collection.reviews.length === 1 ? "Part" : `${collection.reviews.length} parts`}</span>
        {totalGroups > 0 && <span title="Code groups reviewed across loaded parts">{reviewedGroups}/{totalGroups} groups</span>}
      </div>
      <ol className="brief-chapters">
        {collection.reviews.map((entry, index) => {
          const current = entry.id === review?.id;
          const questions = attention?.reviews[entry.id]?.questions.length ?? 0;
          return <li key={entry.id} className={`brief-chapter${current ? " current" : ""}`}>
            <button className="brief-chapter-button" aria-current={current ? "page" : undefined} onClick={() => onReview(entry.id)}
              title={entry.brief ? entry.title : `${entry.title} · opens its code`}>
              <span className="brief-chapter-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="brief-chapter-title">{entry.title}</span>
              <span className="brief-chapter-meta">
                {!!questions && !current && <span className="contents-question" title={`${questions} unanswered ${questions === 1 ? "question" : "questions"}`}>?</span>}
                {!entry.brief && <Code2 size={12} aria-label="Code only" />}
                <PartStatus progress={progress[entry.id]} />
              </span>
            </button>
            {current && <Headings outline={outline} active={active} counts={counts} code={code} onHeading={onHeading} />}
          </li>;
        })}
      </ol>
    </div>
  </nav>;
}
