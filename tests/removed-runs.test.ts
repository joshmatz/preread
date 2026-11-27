import assert from "node:assert/strict";
import { test } from "node:test";
import { removedRuns } from "../src/draw-diff.ts";

test("each run of removed rows folds as one", () => {
  assert.deepEqual(removedRuns(["context", "removed", "removed", "removed", "added", "context", "removed"]),
    [{ start: 1, end: 4 }, { start: 6, end: 7 }]);
  assert.deepEqual(removedRuns(["context", "added"]), []);
});

test("in split view, a removed line beside an added one stays shown", () => {
  const old = ["context", "removed", "removed", "removed", "context", "removed"] as const;
  const next = ["context", "added", "empty", "empty", "context", "added"] as const;
  assert.deepEqual(removedRuns([...old], [...next]), [{ start: 2, end: 4 }]);
});
