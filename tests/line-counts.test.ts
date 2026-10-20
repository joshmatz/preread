import assert from "node:assert/strict";
import { test } from "node:test";
import { lineArea, lineCounts } from "../src/line-counts.ts";
import type { ChangedFile } from "../src/types.ts";

test("line areas split runtime code from tests, evals, and everything else", () => {
  const cases: [string, string][] = [
    ["src/App.tsx", "runtime"],
    ["server/git.ts", "runtime"],
    ["src/style.css", "runtime"],
    ["migrations/0007_delivery_attempts.sql", "runtime"],
    ["scripts/refresh.sh", "runtime"],
    ["src/eval.ts", "runtime"],
    ["src/evaluate.ts", "runtime"],
    ["tests/git.test.ts", "tests"],
    ["src/RetryBadge.spec.tsx", "tests"],
    ["tests/fixtures/payload.json", "tests"],
    ["tests/fixture/pnpm-lock.yaml", "tests"],
    ["src/__snapshots__/Badge.test.tsx.snap", "tests"],
    ["evals/judges/2026-10-09-comparison.md", "evals"],
    ["apps/web/evals/cases.jsonl", "evals"],
    ["evals/refills.test.ts", "evals"],
    ["src/answers.eval.ts", "evals"],
    ["apps/runva/vitest.eval.config.ts", "evals"],
    ["README.md", "misc"],
    ["docs/collections.md", "misc"],
    ["package.json", "misc"],
    ["pnpm-lock.yaml", "misc"],
    ["fixtures/events.json", "misc"],
    [".github/workflows/ci.yml", "misc"],
    ["vite.config.ts", "misc"],
    ["public/logo.svg", "misc"],
  ];
  for (const [path, area] of cases) assert.equal(lineArea(path), area, path);
});

test("line counts total each area and the whole comparison", () => {
  const file = (path: string, additions: number, deletions: number): ChangedFile => ({
    path,
    status: "M",
    additions,
    deletions,
    binary: false,
  });
  const { areas, total } = lineCounts([
    file("src/App.tsx", 40, 5),
    file("server/git.ts", 15, 2),
    file("tests/git.test.ts", 77, 1),
    file("evals/cases.jsonl", 503, 36),
    file("README.md", 12, 3),
  ]);
  assert.deepEqual(areas, {
    runtime: { plus: 55, minus: 7 },
    tests: { plus: 77, minus: 1 },
    evals: { plus: 503, minus: 36 },
    misc: { plus: 12, minus: 3 },
  });
  assert.deepEqual(total, { plus: 647, minus: 47 });
});
