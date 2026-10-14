import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parsePullRequest,
  type PullRequestResult,
  type PullRequestStatus,
} from "../src/pull-requests.ts";

const execute = promisify(execFile);
type GitHubStatus = Omit<PullRequestStatus, "checks" | "checkedAt"> & {
  statusCheckRollup?: { status?: string; conclusion?: string; state?: string }[] | null;
};
export function normalizeStatus(raw: GitHubStatus, checkedAt: string): PullRequestStatus {
  if (!["OPEN", "CLOSED", "MERGED"].includes(raw.state) || !raw.headRefOid || !raw.baseRefOid)
    throw new Error("GitHub returned incomplete PR details.");
  const checks = { passed: 0, failed: 0, pending: 0, unknown: 0, skipped: 0, total: 0 };
  for (const check of raw.statusCheckRollup ?? []) {
    checks.total += 1;
    const state = check.conclusion || check.state || check.status;
    if (state === "SUCCESS") checks.passed += 1;
    else if (["NEUTRAL", "SKIPPED"].includes(state ?? "")) checks.skipped += 1;
    else if (
      [
        "FAILURE",
        "ERROR",
        "TIMED_OUT",
        "CANCELLED",
        "ACTION_REQUIRED",
        "STARTUP_FAILURE",
        "STALE",
      ].includes(state ?? "")
    )
      checks.failed += 1;
    else if (["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(state ?? ""))
      checks.pending += 1;
    else checks.unknown += 1;
  }
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    isDraft: raw.isDraft,
    reviewDecision: raw.reviewDecision,
    headRefOid: raw.headRefOid,
    baseRefOid: raw.baseRefOid,
    checks,
    checkedAt,
  };
}
async function readGitHub(url: string) {
  const { repository, number } = parsePullRequest(url);
  const { stdout } = await execute(
    "gh",
    [
      "pr",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      "number,title,state,isDraft,reviewDecision,headRefOid,baseRefOid,statusCheckRollup",
    ],
    {
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
    },
  );
  return JSON.parse(stdout) as GitHubStatus;
}
export function createPullRequestReader(read = readGitHub, now = Date.now) {
  const cache = new Map<string, { result: PullRequestResult; expires: number }>();
  const pending = new Map<string, Promise<PullRequestResult>>();
  return (input: string, refresh = false): Promise<PullRequestResult> => {
    const { url } = parsePullRequest(input);
    const saved = cache.get(url);
    if (pending.has(url)) return pending.get(url)!;
    if (!refresh && saved && saved.expires > now()) return Promise.resolve(saved.result);
    const request = (async () => {
      let result: PullRequestResult;
      try {
        result = { url, status: normalizeStatus(await read(url), new Date(now()).toISOString()) };
      } catch (cause) {
        const error = cause as NodeJS.ErrnoException;
        result = {
          url,
          status: saved?.result.status,
          error:
            error.code === "ENOENT"
              ? "GitHub CLI is unavailable. Install gh and sign in to load PR status."
              : "Could not refresh GitHub status. Check your connection and gh sign-in, then retry.",
        };
      }
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(url, { result, expires: now() + (result.error ? 15_000 : 60_000) });
      return result;
    })().finally(() => pending.delete(url));
    pending.set(url, request);
    return request;
  };
}
export const readPullRequest = createPullRequestReader();
