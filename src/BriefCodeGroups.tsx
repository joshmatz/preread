import React, { useState } from "react";
import { ArrowRight, Check, CheckCheck, LoaderCircle } from "lucide-react";
import type { Collection, ProgressSource, Review } from "./review-types";
import type { BriefReference } from "./brief-types";
import { BriefGroupStatus, type GroupReadState } from "./BriefGroupStatus";
import { isTestFile } from "./file-kinds";

export type MarkTargets = Array<{ review: string; groups: string[] }>;
export type MarkGroups = (key: string, targets: MarkTargets, reviewed: boolean) => Promise<string[]>;
type Row = { review: Review; group: string };

export const groupMarkKey = (review: string, group: string) => `@brief:${review}/${group}`;
export const groupTitle = (review: Review, group: string) =>
  review.groups.find((entry) => entry.id === group)?.title ?? (group === "other-changes" ? (review.groups.length ? "Other changes" : "All changes") : group);

export function BriefCodeGroups({ id, title, collection, current, rows, sources, marking, stateOf, onOpen, onMark }: {
  id: string; title: string; collection: Collection; current?: string; rows: Row[]; sources: Record<string, ProgressSource>;
  marking: string; stateOf: (reference: BriefReference) => GroupReadState;
  onOpen: (reference: BriefReference) => void; onMark: MarkGroups;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const states = rows.map((row) => stateOf({ review: row.review.id, group: row.group }));
  const markable = (state: GroupReadState) => state.kind === "unreviewed" || state.kind === "partial" || state.kind === "changed";
  const remaining = rows.filter((_, index) => markable(states[index]));
  const reviewed = states.filter((state) => state.kind === "reviewed").length;
  const bulkKey = `@brief:${id}`;
  const mark = async (key: string, targets: Row[], value: boolean) => {
    const grouped: MarkTargets = [];
    for (const row of targets) {
      const entry = grouped.find((target) => target.review === row.review.id);
      if (entry) entry.groups.push(row.group); else grouped.push({ review: row.review.id, groups: [row.group] });
    }
    setErrors(await onMark(key, grouped, value));
  };
  return <section className="brief-section-code" aria-label={title}>
    <header>
      <h3>{title}</h3>
      <span className="brief-section-code-count">{reviewed} of {rows.length} reviewed</span>
      {remaining.length > 1 && <button className="brief-mark-all" disabled={!!marking} onClick={() => mark(bulkKey, remaining, true)}>
        {marking === bulkKey ? <LoaderCircle size={13} className="spin" /> : <CheckCheck size={13} />}Mark {remaining.length} reviewed</button>}
    </header>
    <ul>
      {rows.map((row, index) => {
        const state = states[index];
        const files = sources[row.review.id]?.sections.find((section) => section.id === row.group)?.files ?? [];
        const tests = files.length > 0 && files.every((file) => isTestFile(file.path));
        const key = groupMarkKey(row.review.id, row.group);
        const part = collection.reviews.findIndex((entry) => entry.id === row.review.id) + 1;
        const done = state.kind === "reviewed";
        return <li key={`${row.review.id}/${row.group}`} className={done ? "is-reviewed" : undefined}>
          <button className="brief-section-code-title" onClick={() => onOpen({ review: row.review.id, group: row.group })}>
            <span>{groupTitle(row.review, row.group)}</span>
            <small>{[row.review.id !== current && `Part ${part}`, files.length && `${files.length} ${files.length === 1 ? "file" : "files"}`].filter(Boolean).join(" · ")}{tests && <span className="brief-tests-tag">Tests</span>}</small>
          </button>
          <BriefGroupStatus state={state} />
          <span className="brief-section-code-actions">
            {(markable(state) || done) && <button className={`brief-mark${done ? " is-reviewed" : ""}`} aria-pressed={done} disabled={!!marking}
              title={done ? "Unmark every file in this group" : "Mark every file in this group viewed, as Mark all viewed does in the code"}
              onClick={() => mark(key, [row], !done)}>
              {marking === key ? <LoaderCircle size={13} className="spin" /> : done ? <Check size={13} /> : null}{done ? "Reviewed" : "Mark reviewed"}</button>}
            <button className="brief-open-group" aria-label={`Open ${groupTitle(row.review, row.group)}`} onClick={() => onOpen({ review: row.review.id, group: row.group })}><ArrowRight size={14} /></button>
          </span>
        </li>;
      })}
    </ul>
    {errors.length > 0 && <div className="brief-error" role="alert">{errors.join("\n")}</div>}
  </section>;
}
