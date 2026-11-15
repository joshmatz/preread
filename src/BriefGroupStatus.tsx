import React from "react";
import { AlertTriangle, CheckCheck, Circle, CircleDashed, CircleHelp, LoaderCircle, RotateCcw } from "lucide-react";
import { sectionViewed } from "./progress";
import type { ProgressSource, ReviewProgress } from "./review-types";

export type GroupReadState =
  | { kind: "checking" }
  | { kind: "unavailable"; message: string }
  | { kind: "unreviewed" | "partial" | "reviewed" | "changed" | "attention"; viewed: number; total: number };

export function groupReadState({ group, source, progress }: {
  group: string; source?: ProgressSource; progress?: ReviewProgress;
}): GroupReadState {
  if (progress?.status === "unavailable") return { kind: "unavailable", message: progress.error || "Could not check this code group." };
  if (!source) return progress ? { kind: "unavailable", message: "Could not check this code group." } : { kind: "checking" };
  const section = source.sections.find((entry) => entry.id === group);
  if (!section) return { kind: "unavailable", message: "This code group is no longer in the review." };
  const total = section.files.length;
  const viewed = section.files.filter((file) => file.viewed ?? section.reviewed).length;
  const kind = !section.canReview || !total ? "attention"
    : sectionViewed(section) ? "reviewed"
    : section.changedSinceReview ? "changed"
    : viewed ? "partial" : "unreviewed";
  return { kind, viewed, total };
}

export function BriefGroupStatus({ state, subject = "Code group" }: { state: GroupReadState; subject?: string }) {
  let label: string;
  let description: string;
  switch (state.kind) {
    case "checking": label = "Checking…"; description = "Checking this code group’s review status."; break;
    case "unavailable": label = "Unavailable"; description = state.message; break;
    case "reviewed": label = "Reviewed"; description = `All ${state.total} files in this code group are viewed.`; break;
    case "changed": label = "Changed since review"; description = `This code group changed since review. ${state.viewed} of ${state.total} files are viewed.`; break;
    case "attention": label = "Needs attention"; description = "This code group has missing or unavailable changes and cannot be fully reviewed yet."; break;
    case "partial": label = `${state.viewed}/${state.total} viewed`; description = `${state.viewed} of ${state.total} files in this code group are viewed.`; break;
    case "unreviewed": label = "Not reviewed"; description = `${state.total} files in this code group still need review.`; break;
  }
  const Icon = { checking: LoaderCircle, unavailable: CircleHelp, reviewed: CheckCheck, changed: RotateCcw,
    attention: AlertTriangle, partial: CircleDashed, unreviewed: Circle }[state.kind];
  return <span className={`brief-group-status status-${state.kind}`} role="img" aria-label={`${subject}: ${label}. ${description}`}
    title={description} data-label={label}><Icon aria-hidden="true" size={12} className={state.kind === "checking" ? "spin" : undefined} /></span>;
}
