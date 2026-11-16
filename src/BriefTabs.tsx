import React from "react";
import { BookOpen, Code2, MessageSquare } from "lucide-react";

export type BriefTab = "brief" | "code" | "feedback";
export function BriefTabs({ label, current, code, feedback, replies = 0, onBrief, onCode, onFeedback }: {
  label: string; current: BriefTab; code: number | string; feedback: number | string; replies?: number;
  onBrief: () => void; onCode: () => void; onFeedback: () => void;
}) {
  const page = (tab: BriefTab) => current === tab ? "page" : undefined;
  return <nav className="brief-tabs" aria-label={label}>
    <button aria-current={page("brief")} onClick={onBrief}><BookOpen size={14} />Overview</button>
    <button aria-current={page("code")} onClick={onCode} title="Code groups left to review"><Code2 size={14} />Code <span className="pill">{code}</span></button>
    <button aria-current={page("feedback")} onClick={onFeedback} title={replies ? `Your agent replied to ${replies === 1 ? "one item" : `${replies} items`}` : "Open feedback"}>
      <MessageSquare size={14} />Feedback <span className={replies ? "pill has-replies" : "pill"}>{feedback}</span>
      {replies > 0 && <span className="sr-only">, {replies} with replies from your agent</span>}</button>
  </nav>;
}
