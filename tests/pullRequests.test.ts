import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePullRequest, comparisonMatch, checksLabel } from "../src/pull-requests.ts";
import { createPullRequestReader, normalizeStatus } from "../server/pullRequests.ts";
import { validateCollection } from "../server/collections.ts";
import type { Comparison } from "../src/types.ts";

const raw = {
  number: 42,
  title: "Example",
  state: "OPEN" as const,
  isDraft: false,
  reviewDecision: "REVIEW_REQUIRED",
  headRefOid: "head",
  baseRefOid: "base",
};
const url = "https://github.com/owner/repo/pull/42";
test("PR links accept GitHub diff URLs and reject other hosts, credentials, schemes and command-like inputs", () => {
  assert.equal(parsePullRequest(`${url}/changes#diff-test`).url, url);
  for (const value of [
    "javascript:alert(1)",
    "https://github.com.evil.test/o/r/pull/1",
    "https://user@github.com/o/r/pull/1",
    "https://github.com:443/o/r/pull/1",
    "--repo=x",
    "https://github.com/o/../pull/1",
    "https://github.com/o/r/issues/1",
  ])
    assert.throws(() => parsePullRequest(value));
});
test("collection validation persists an optional PR without changing review groups", () => {
  const review = {
    id: "one",
    title: "One",
    description: "",
    path: "/tmp/repo",
    base: "main",
    mode: "branch",
    groups: [],
  };
  const collection = { id: "example", title: "Example", reviews: [review] };
  assert.equal(validateCollection(collection).reviews[0].pullRequest, undefined);
  assert.equal(
    validateCollection({ ...collection, reviews: [{ ...review, pullRequest: `${url}/files` }] })
      .reviews[0].pullRequest,
    url,
  );
  assert.throws(() =>
    validateCollection({
      ...collection,
      reviews: [{ ...review, pullRequest: "https://example.com" }],
    }),
  );
});
test("check rollups distinguish failures, pending jobs, no checks and unknown conclusions", () => {
  const status = normalizeStatus(
    {
      ...raw,
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { state: "SUCCESS" },
        { status: "COMPLETED", conclusion: "FAILURE" },
        { state: "ERROR" },
        { status: "IN_PROGRESS", conclusion: "" },
        { state: "PENDING" },
        { status: "COMPLETED", conclusion: "NEW_VALUE" },
      ],
    },
    "today",
  );
  assert.deepEqual(status.checks, {
    passed: 2,
    failed: 2,
    pending: 2,
    unknown: 1,
    skipped: 0,
    total: 7,
  });
  assert.equal(checksLabel(status.checks), "2 failing · 2 pending");
  assert.equal(checksLabel(normalizeStatus(raw, "today").checks), "No checks");
  assert.equal(
    checksLabel({ passed: 1, failed: 0, pending: 0, unknown: 1, skipped: 0, total: 2 }),
    "Checks unavailable",
  );
});
test("remote reads are coalesced and cached, with explicit refresh and retained stale status on failure", async () => {
  let calls = 0;
  let now = 1000;
  let fails = false;
  const read = createPullRequestReader(
    async () => {
      calls += 1;
      if (fails) throw new Error("offline");
      return raw;
    },
    () => now,
  );
  const [first, second] = await Promise.all([read(url), read(url)]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  await read(url);
  assert.equal(calls, 1);
  await read(url, true);
  assert.equal(calls, 2);
  now += 61_000;
  fails = true;
  const stale = await read(url);
  assert.equal(calls, 3);
  assert.equal(stale.status?.state, "OPEN");
  assert.match(stale.error!, /Could not refresh/);
  await read(url);
  assert.equal(calls, 3);
  fails = false;
  assert.equal((await read(url, true)).error, undefined);
});
test("matching commit labels never claim a working or differently based diff matches the PR", () => {
  const comparison = { head: "head", baseSha: "base" } as Comparison;
  const status = normalizeStatus(raw, "today");
  assert.match(comparisonMatch(comparison, "branch", status), /match PR$/);
  assert.match(
    comparisonMatch({ ...comparison, baseSha: "other" }, "branch", status),
    /base differ/,
  );
  assert.match(comparisonMatch({ ...comparison, head: "other" }, "branch", status), /head differ/);
  for (const mode of ["working", "staged", "all"] as const)
    assert.match(comparisonMatch(comparison, mode, status), /different scope/);
});
