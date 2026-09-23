import { ExternalLink, GitPullRequest, RefreshCw } from "lucide-react";
import type { Comparison, Mode } from "./types";
import type { PullRequestEntry } from "./usePullRequests";
import { checksLabel, comparisonMatch, parsePullRequest, pullRequestState } from "./pull-requests";

export function PullRequest({
  url,
  entry,
  comparison,
  mode,
  onRefresh,
  compact = false,
}: {
  url: string;
  entry?: PullRequestEntry;
  comparison?: Comparison;
  mode?: Mode;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  const status = entry?.result?.status;
  const error = entry?.result?.error;
  const state = status ? pullRequestState(status) : "";
  const review =
    status &&
    (
      {
        APPROVED: "Approved on GitHub",
        CHANGES_REQUESTED: "Changes requested",
        REVIEW_REQUIRED: "Review required",
      } as Record<string, string>
    )[status.reviewDecision];
  const linkText = `PR #${parsePullRequest(url).number}`;
  return (
    <div className={`pull-request ${compact ? "compact" : ""}`}>
      <div className="pr-status-row">
        <a href={url} target="_blank" rel="noreferrer" title={status?.title}>
          <GitPullRequest size={14} />
          {linkText}
          <ExternalLink size={12} />
        </a>
        <span className={`pr-state pr-${state.toLowerCase()}`}>{state}</span>
        <span className="pr-checks">
          {status ? checksLabel(status.checks) : error ? "Status unavailable" : "Checking GitHub…"}
        </span>
        {!compact && review && <span>{review}</span>}
        {compact && error && status && <span>Last known status</span>}
        {!compact && onRefresh && (
          <button
            className="icon-button"
            aria-label="Refresh PR status"
            title="Refresh PR status"
            disabled={entry?.loading}
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
      {!compact && (
        <div className="pr-details" role="status">
          {entry?.loading && status && <span>Refreshing GitHub…</span>}
          {error && (
            <span className="pr-error">
              {error}
              {status ? " Showing last known status." : ""}
            </span>
          )}
          {status && comparison && mode && <span>{comparisonMatch(comparison, mode, status)}</span>}
          {status && (
            <span title={new Date(status.checkedAt).toLocaleString()}>
              Checked{" "}
              {new Date(status.checkedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
