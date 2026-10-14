import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileViews, saveFileViews, withSharedFileViews } from "../server/file-views.ts";
import { groupPreviews } from "../server/review.ts";

let directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "preread-file-views-"));
  process.env.PREREAD_DATA_DIR = directory;
});
after(async () => {
  delete process.env.PREREAD_DATA_DIR;
  await rm(directory, { recursive: true, force: true });
});

test("simultaneous clicks preserve both marks and a later unmark wins", async () => {
  const first = { path: "a.ts", viewHash: "first", viewed: true };
  const second = { path: "b.ts", viewHash: "second", viewed: true };
  await Promise.all([saveFileViews("/repo", [first]), saveFileViews("/repo", [second])]);
  assert.deepEqual(Object.values(await readFileViews("/repo")), [true, true]);
  await saveFileViews("/repo", [{ ...first, viewed: false }]);
  assert.deepEqual(Object.values(await readFileViews("/repo")), [false, true]);
  assert.deepEqual(await readFileViews("/other-repo"), {});
});

test("fresh snapshots read disk marks without leaking across content or worktrees", async () => {
  const scope = { id: "fresh", path: "/fresh", base: "main", mode: "working" as const };
  const file = { file: { path: "a.ts", status: "M", additions: 1, deletions: 1, binary: false },
    partial: false, diff: { hash: "patch", patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n", binary: false, tooLarge: false, empty: false } };
  const sections = groupPreviews([file], [], {}, scope);
  const viewHash = sections[0].files[0].viewHash!;
  await saveFileViews(scope.path, [{ path: "a.ts", viewHash, viewed: true }]);
  assert.equal((await withSharedFileViews(scope.path, sections))[0].files[0].viewed, true);
  assert.equal((await withSharedFileViews("/different", sections))[0].files[0].viewed, false);
  const changed = groupPreviews([{ ...file, diff: { ...file.diff, patch: file.diff.patch.replace("+new", "+changed") } }], [], {}, scope);
  assert.equal((await withSharedFileViews(scope.path, changed))[0].files[0].viewed, false);
});
