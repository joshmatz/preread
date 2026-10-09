import React, { useId, useState, type ReactNode } from "react";
import { CheckCheck, ChevronDown, ChevronRight } from "lucide-react";

export function OutlineGroup({
  title,
  reviewed,
  revision,
  hiddenUnreadCount,
  filtering,
  onJump,
  children,
}: {
  title: string;
  reviewed: boolean;
  revision: string;
  hiddenUnreadCount: number;
  filtering: boolean;
  onJump: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  const [state, setState] = useState({ reviewed, revision, collapsed: reviewed });
  // A new completion collapses the group; unread changes reopen it. Ordinary
  // refreshes preserve a reader's manual choice while progress stays the same.
  const current = state.reviewed === reviewed && state.revision === revision;
  if (!current) setState({ reviewed, revision, collapsed: reviewed });
  const collapsed = !filtering && (current ? state.collapsed : reviewed);
  return (
    <div className="index-group">
      <div className="index-group-head">
        <button
          className="index-group-toggle"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          title={filtering ? "Groups stay expanded while filtering" : undefined}
          disabled={filtering}
          onClick={() => setState({ reviewed, revision, collapsed: !collapsed })}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <button className="index-group-title" onClick={onJump}>
          {reviewed ? (
            <CheckCheck size={15} className="additions" />
          ) : (
            <span className="group-dot" />
          )}
          <span>{title}</span>
        </button>
      </div>
      {hiddenUnreadCount > 0 && (
        <small className="index-hidden">
          {hiddenUnreadCount} hidden test {hiddenUnreadCount === 1 ? "file" : "files"} not viewed
        </small>
      )}
      <div id={bodyId} hidden={collapsed}>
        {children}
      </div>
    </div>
  );
}
