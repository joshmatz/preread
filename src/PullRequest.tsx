import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, RefreshCw } from "lucide-react";
import type { Comparison, Mode } from "./types";
import type { Review } from "./review-types";
import type { PullRequestEntry } from "./usePullRequests";
import {
  checksLabel,
  comparisonMatch,
  parsePullRequest,
  pullRequestFacts,
  pullRequestState,
} from "./pull-requests";

export function PullRequestLine({ url, entry }: { url: string; entry?: PullRequestEntry }) {
  const status = entry?.result?.status;
  const error = entry?.result?.error;
  const state = status ? pullRequestState(status) : "";
  const facts = status
    ? [...pullRequestFacts(status), ...(error ? ["Last known status"] : [])]
    : [error ? "Status unavailable" : "Checking GitHub…"];
  return (
    <span className="pr-line">
      <GitPullRequest size={12} />
      <span>
        PR #{parsePullRequest(url).number}
        {state && (
          <>
            {" · "}
            <span className={`pr-state pr-${state.toLowerCase()}`}>{state}</span>
          </>
        )}
        {facts.map((fact) => ` · ${fact}`)}
      </span>
    </span>
  );
}

const stateIcons = { Open: GitPullRequest, Draft: GitPullRequestDraft, Merged: GitMerge, Closed: GitPullRequestClosed };

// A stack can hold dozens of parts, so a chip spells out only what keeps its PR from merging.
export function PullRequestChips({ reviews, entries }: { reviews: Review[]; entries: Record<string, PullRequestEntry> }) {
  const linked = reviews.flatMap((review, index) => review.pullRequest ? [{ review, part: index + 1, url: review.pullRequest }] : []);
  if (!linked.length) return null;
  return (
    <div className="pr-chips">
      <span className="pr-chips-label">{linked.length === 1 ? "Pull request" : `${linked.length} pull requests`}</span>
      <ul>
        {linked.map(({ review, part, url }) => {
          const result = entries[url]?.result;
          const status = result?.status;
          const state = status ? pullRequestState(status) : undefined;
          const Icon = state ? stateIcons[state] : GitPullRequest;
          const number = parsePullRequest(url).number;
          const blocker = status?.state === "OPEN"
            ? status.checks.failed ? `${status.checks.failed} failing` : status.reviewDecision === "CHANGES_REQUESTED" ? "Changes requested" : ""
            : "";
          const facts = status
            ? [state, ...pullRequestFacts(status), ...(result?.error ? ["Last known status"] : [])]
            : [result?.error ? "Status unavailable" : "Checking GitHub…"];
          return (
            <li key={review.id}>
              <a className="pr-chip" href={url} target="_blank" rel="noreferrer"
                aria-label={`Part ${part}, ${review.title}: PR #${number}, ${facts.join(", ")}`}
                title={[`Part ${part} · ${review.title}`, `PR #${number}${status ? ` · ${status.title}` : ""}`, facts.join(" · ")].join("\n")}>
                <Icon size={13} className={`pr-${state?.toLowerCase() ?? "checking"}`} aria-hidden="true" />#{number}
                {blocker && <span className="pr-chip-blocker">{blocker}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
