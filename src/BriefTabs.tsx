import React from "react";
import { BookOpen, Code2, MessageSquare } from "lucide-react";

export type BriefTab = "brief" | "code" | "feedback";
export function BriefTabs({ label, current, code, feedback, onBrief, onCode, onFeedback }: {
  label: string; current: BriefTab; code: number | string; feedback: number | string;
  onBrief: () => void; onCode: () => void; onFeedback: () => void;
}) {
  const page = (tab: BriefTab) => current === tab ? "page" : undefined;
  return <nav className="brief-tabs" aria-label={label}>
    <button aria-current={page("brief")} onClick={onBrief}><BookOpen size={14} />Overview</button>
    <button aria-current={page("code")} onClick={onCode} title="Code groups left to review"><Code2 size={14} />Code <span className="pill">{code}</span></button>
    <button aria-current={page("feedback")} onClick={onFeedback}><MessageSquare size={14} />Feedback <span className="pill">{feedback}</span></button>
  </nav>;
}
