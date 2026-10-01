import { test } from "node:test";
import assert from "node:assert/strict";
import { currentKey, fileViewed, migrateMarks, setFilesViewed } from "../src/useFileState.ts";
import { memoryStorage } from "./memory-storage.ts";

const hash = "0123456789abcdef".repeat(4);

test("earlier Viewed keys drop the review's base and mode but keep its worktree", () => {
  assert.equal(
    currentKey(`file-viewed:/repo|origin/develop|all|src/a.ts|${hash}`),
    `file-viewed:/repo|src/a.ts|${hash}`,
  );
  assert.equal(
    currentKey(`file-collapsed:/repo|staged|branch|src/a.ts|${hash}`),
    `file-collapsed:/repo|src/a.ts|${hash}`,
  );
  assert.equal(
    currentKey("file-viewed:~/repo||working|odd|name.md|"),
    "file-viewed:~/repo|odd|name.md|",
  );
});
test("current keys and other storage are left alone", () => {
  assert.equal(currentKey(`file-viewed:/repo|src/a.ts|${hash}`), undefined);
  assert.equal(currentKey(`file-viewed:/repo|odd|name.md|${hash}`), undefined);
  assert.equal(currentKey(`file-viewed:/a|b|repo|main|branch|src/a.ts|${hash}`), undefined);
  assert.equal(currentKey("notes"), undefined);
});
test("old keys move to worktree keys, and viewed wins when old reviews disagree", () => {
  const { storage, items } = memoryStorage({
    [`file-viewed:/repo|main|branch|src/a.ts|${hash}`]: "false",
    [`file-viewed:/repo|origin/main|all|src/a.ts|${hash}`]: "true",
    [`file-viewed:/other|main|branch|src/a.ts|${hash}`]: "false",
    [`file-collapsed:/repo|main|branch|src/a.ts|${hash}`]: "false",
    [`file-collapsed:/repo|src/a.ts|${hash}`]: "true",
    [`file-viewed:/a|b|repo|main|branch|src/a.ts|${hash}`]: "true",
    theme: "dark",
  });
  migrateMarks(storage);
  assert.deepEqual(Object.fromEntries(items), {
    [`file-viewed:/repo|src/a.ts|${hash}`]: "true",
    [`file-viewed:/other|src/a.ts|${hash}`]: "false",
    [`file-collapsed:/repo|src/a.ts|${hash}`]: "true",
    [`file-viewed:/a|b|repo|main|branch|src/a.ts|${hash}`]: "true",
    theme: "dark",
  });
});
test("a mark stays with its worktree", () => {
  const file = { path: "src/a.ts", viewHash: hash, patchHash: hash };
  setFilesViewed("/repo", [file], true);
  assert.equal(fileViewed("/repo", file), true);
  assert.equal(fileViewed("/other", file), false);
});
test("a mark saved under a patch hash moves to its view hash and outlasts edits elsewhere", () => {
  const file = { path: "src/b.ts", viewHash: "view", patchHash: "patch" };
  setFilesViewed("/repo", [{ ...file, viewHash: "patch" }], true);
  assert.equal(fileViewed("/repo", file), true);
  assert.equal(fileViewed("/repo", { ...file, patchHash: "edited elsewhere" }), true);
  assert.equal(fileViewed("/repo", { ...file, viewHash: "edited", patchHash: "edited" }), false);
  assert.equal(fileViewed("/other", file), false);
  setFilesViewed("/repo", [file], false);
  assert.equal(fileViewed("/repo", file, true), false);
  assert.equal(fileViewed("/repo", { ...file, path: "src/c.ts" }, true), true);
});
