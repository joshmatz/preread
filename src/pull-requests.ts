import type { Comparison, Mode } from "./types";

export function parsePullRequest(input: string) {
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|changes|commits|checks))?\/?(?:[?#].*)?$/.exec(
      input.trim(),
    );
  if (!match || [".", ".."].includes(match[2]) || !Number.isSafeInteger(Number(match[3])))
    throw new Error(
      "Use a GitHub pull request URL, such as https://github.com/owner/repo/pull/123.",
    );
  return {
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
    repository: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
  };
}
export interface PullRequestStatus {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  reviewDecision: string;
  headRefOid: string;
  baseRefOid: string;
  checks: {
    passed: number;
    failed: number;
    pending: number;
    unknown: number;
    skipped: number;
    total: number;
  };
  checkedAt: string;
}
export interface PullRequestResult {
  url: string;
  status?: PullRequestStatus;
  error?: string;
}
export function pullRequestState(status: PullRequestStatus) {
  if (status.state === "MERGED") return "Merged";
  if (status.state === "CLOSED") return "Closed";
  return status.isDraft ? "Draft" : "Open";
}
export function checksLabel(checks: PullRequestStatus["checks"]) {
  if (!checks.total) return "No checks";
  if (checks.failed)
    return `${checks.failed} failing${checks.pending ? ` · ${checks.pending} pending` : ""}`;
  if (checks.pending) return `${checks.pending} checks pending`;
  if (checks.unknown) return "Checks unavailable";
  return `${checks.passed} checks passed${checks.skipped ? ` · ${checks.skipped} skipped/neutral` : ""}`;
}
export function comparisonMatch(comparison: Comparison, mode: Mode, status: PullRequestStatus) {
  if (mode !== "branch") return "Local comparison includes a different scope than the PR";
  const differences = [];
  if (comparison.head !== status.headRefOid) differences.push("head");
  if (comparison.baseSha !== status.baseRefOid) differences.push("base");
  return differences.length
    ? `Local ${differences.join(" and ")} ${differences.length === 1 ? "differs" : "differ"} from PR`
    : "Local head and base match PR";
}
