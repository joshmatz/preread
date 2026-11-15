import React, { useLayoutEffect, useRef } from "react";
import { AlertTriangle, BookOpen, CheckCheck, Circle, CircleDashed, CircleHelp, Code2, LoaderCircle, MessageSquare, Minus, RotateCcw, X } from "lucide-react";
import type { Collection, Review, ReviewProgress } from "./review-types";
import type { CollectionAttention } from "./brief-types";
import type { OutlineHeading } from "./brief-outline";

export type HeadingCounts = Record<string, { comments: number; questions: number }>;

const statusIcons = { reviewed: CheckCheck, partial: CircleDashed, changed: RotateCcw, attention: AlertTriangle,
  unreviewed: Circle, empty: Minus, unavailable: CircleHelp } as const;
const statusWords = { reviewed: "Reviewed", partial: "Partly reviewed", changed: "Changed since review", attention: "Needs attention",
  unreviewed: "Not reviewed", empty: "No changes", unavailable: "Couldn’t check" } as const;

export function PartStatus({ progress }: { progress?: ReviewProgress }) {
  if (!progress) return <span className="part-status status-checking" title="Checking review status"><LoaderCircle size={12} className="spin" aria-hidden="true" /><span className="sr-only">Checking</span></span>;
  const Icon = statusIcons[progress.status];
  const count = progress.status === "empty" || progress.status === "unavailable" ? "" : `${progress.reviewedGroups}/${progress.totalGroups}`;
  return <span className={`part-status status-${progress.status}`} title={progress.error || `${statusWords[progress.status]}${count ? ` · ${count} groups` : ""}`}>
    <Icon size={12} aria-hidden="true" /><span className="sr-only">{statusWords[progress.status]}</span>{count && <span>{count}</span>}
  </span>;
}

function Headings({ outline, active, counts, onHeading }: {
  outline: OutlineHeading[]; active: string; counts: HeadingCounts; onHeading: (heading: OutlineHeading) => void;
}) {
  if (!outline.length) return null;
  return <ol className="brief-contents-headings">
    {outline.map((heading) => {
      const count = counts[heading.key];
      return <li key={heading.key} className={`level-${heading.level}`}>
        <button aria-current={active === heading.key ? "location" : undefined} onClick={() => onHeading(heading)}>
          <span>{heading.text}</span>
          {!!count?.questions && <span className="contents-question" title={`${count.questions} unanswered ${count.questions === 1 ? "question" : "questions"}`}>?</span>}
          {!!count?.comments && <span className="contents-count" title={`${count.comments} ${count.comments === 1 ? "comment" : "comments"}`}><MessageSquare size={10} aria-hidden="true" />{count.comments}</span>}
        </button>
      </li>;
    })}
  </ol>;
}

export function BriefContents({ collection, review, outline, active, counts, progress, attention, onHeading, onFeature, onReview, onClose }: {
  collection: Collection; review?: Review; outline: OutlineHeading[]; active: string; counts: HeadingCounts;
  progress: Record<string, ReviewProgress>; attention?: CollectionAttention;
  onHeading: (heading: OutlineHeading) => void; onFeature: () => void; onReview: (id: string) => void; onClose?: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = list.current;
    const current = container?.querySelector<HTMLElement>("[aria-current=page]");
    if (!container || !current) return;
    const top = current.offsetTop - container.offsetTop;
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - 60) container.scrollTop = Math.max(0, top - 48);
  }, [review?.id]);
  const loaded = collection.reviews.filter((entry) => progress[entry.id]);
  const reviewedGroups = loaded.reduce((sum, entry) => sum + progress[entry.id].reviewedGroups, 0);
  const totalGroups = loaded.reduce((sum, entry) => sum + progress[entry.id].totalGroups, 0);
  const featureQuestions = attention?.feature?.questions.length ?? 0;
  return <nav className="brief-contents" id="brief-contents" aria-label="Contents">
    <div className="brief-contents-scroll" ref={list}>
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
            {current && <Headings outline={outline} active={active} counts={counts} onHeading={onHeading} />}
          </li>;
        })}
      </ol>
    </div>
  </nav>;
}
