import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { comparison, fileDiff, fileContext } from "../server/git.ts";
import { parsePatch, patchFor } from "../server/patches.ts";
import { groupPreviews } from "../server/review.ts";
import {
  createContextModel,
  contextGaps,
  initialGaps,
  expandContext,
  contextPatch,
} from "../src/diff-context.ts";
import type { Mode } from "../src/types.ts";
let directory: string;
let repo: string;
const run = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
const lines = Array.from(
  { length: 180 },
  (_, index) => `const value${index + 1} = ${index + 1};`,
).join("\n");
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "review-context-")));
  repo = join(directory, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  run("config", "user.name", "Context Test");
  run("config", "user.email", "review@example.test");
  await writeFile(join(repo, "example.ts"), lines);
  await writeFile(join(repo, "rename.ts"), lines);
  await writeFile(join(repo, "tail.ts"), `${lines}\n`);
  run("add", ".");
  run("commit", "-m", "Base");
  run("switch", "-c", "feature");
  const edited = lines
    .replace("value25 = 25", "value25 = 'changed'")
    .replace("value90 = 90", "value90 = 'second'");
  await writeFile(join(repo, "example.ts"), edited);
  await rename(join(repo, "rename.ts"), join(repo, "renamed.ts"));
  await writeFile(join(repo, "renamed.ts"), edited);
  await writeFile(
    join(repo, "tail.ts"),
    `${lines.replace("value178 = 178", "value178 = 'tail'")}\n`,
  );
  run("add", ".");
  run("commit", "-m", "Changes");
  await writeFile(
    join(repo, "example.ts"),
    edited.replace("value130 = 130", "value130 = 'staged'"),
  );
  run("add", "example.ts");
  await writeFile(
    join(repo, "example.ts"),
    edited.replace("value130 = 130", "value130 = 'working'"),
  );
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function load(mode: Mode, path = "example.ts") {
  const info = await comparison(repo, "main", mode);
  const diff = await fileDiff(repo, "main", mode, path, info);
  const full = await fileContext(repo, "main", mode, path, info.version, diff.hash);
  return { info, diff, full, model: createContextModel(diff.patch, full.patch) };
}
test("expanding unchanged gaps preserves changes and merges adjacent hunks with accurate line numbers", async () => {
  const { diff, full, model } = await load("branch");
  assert.equal(model.intervals.length, 2);
  let expanded = expandContext(model, 0, "above");
  assert.match(contextPatch(expanded), /const value1 = 1/);
  assert.equal(contextGaps(expanded)[0].above, 0);
  expanded = expandContext(expanded, 1, "below");
  assert.equal(expanded.intervals.length, 2);
  expanded = expandContext(expanded, 1, "all");
  assert.equal(expanded.intervals.length, 1);
  expanded = expandContext(expanded, 1, "all");
  assert.deepEqual(
    parsePatch(contextPatch(expanded)).hunks.map((h) => [h.oldLines, h.newLines]),
    parsePatch(full.patch).hunks.map((h) => [h.oldLines, h.newLines]),
  );
  assert.match(contextPatch(expanded), /const value180 = 180/);
  assert.match(contextPatch(expanded), /\\ No newline at end of file/);
  const changes = (patch: string) => patch.split("\n").filter((line) => /^[+-]/.test(line));
  assert.deepEqual(changes(contextPatch(expanded)), changes(diff.patch));
});
test("context comes from the selected comparison, including staged versus later working edits and renames", async () => {
  const branch = await load("branch");
  assert.doesNotMatch(branch.full.patch, /'working'|'staged'/);
  const staged = await load("staged");
  assert.match(staged.full.patch, /'staged'/);
  assert.doesNotMatch(staged.full.patch, /'working'/);
  for (const mode of ["all", "working"] as const)
    assert.match((await load(mode)).full.patch, /'working'/);
  const renamed = await load("branch", "renamed.ts");
  assert.match(renamed.full.patch, /rename from rename.ts/);
  assert.equal(renamed.model.intervals.length, 2);
});
test("partial group expansion stops at another group's changes and does not invalidate receipts", async () => {
  const { info, diff, full } = await load("branch");
  const preview = {
    file: info.files.find((file) => file.path === "example.ts")!,
    diff,
    partial: false,
  };
  const groups = [
    {
      id: "first",
      title: "First",
      description: "First decision",
      targets: [{ path: "example.ts", ranges: [{ side: "new" as const, start: 25, end: 25 }] }],
    },
  ];
  const scope = { id: "one", path: repo, base: "main", mode: "branch" as const };
  const original = groupPreviews([preview], groups, {}, scope);
  assert.equal(original[0].files[0].contextHash, diff.hash);
  let expanded = createContextModel(original[0].files[0].diff.patch, full.patch);
  expanded = expandContext(expanded, 1, "below", 1000);
  assert.match(contextPatch(expanded), /value89/);
  assert.doesNotMatch(contextPatch(expanded), /value90|second/);
  assert.equal(contextGaps(expanded)[1].otherChanges, true);
  const after = groupPreviews(
    [preview],
    groups,
    { "one/first": { fingerprint: original[0].fingerprint, reviewedAt: "today" } },
    scope,
  );
  assert.equal(after[0].reviewed, true);
});
test("expansion rejects stale diffs, files outside the comparison and mismatched selected blocks", async () => {
  const { info, diff, full } = await load("branch");
  await assert.rejects(
    fileContext(repo, "main", "branch", "example.ts", "stale", diff.hash),
    /Refresh/,
  );
  await assert.rejects(
    fileContext(repo, "main", "branch", "example.ts", info.version, "old"),
    /Refresh/,
  );
  await assert.rejects(
    fileContext(repo, "main", "branch", "../secret", info.version, diff.hash),
    /not part of/,
  );
  assert.throws(
    () => createContextModel(diff.patch.replace("'changed'", "'newer'"), full.patch),
    /Refresh/,
  );
  const local = await load("working");
  await writeFile(join(repo, "example.ts"), lines.replace("value140 = 140", "value140 = 'newer'"));
  await assert.rejects(
    fileContext(repo, "main", "working", "example.ts", local.info.version, local.diff.hash),
    /Refresh/,
  );
});
test("the compact diff offers lines below its last hunk only when the file can continue", async () => {
  const middle = await load("branch");
  assert.equal(initialGaps(middle.diff.patch).at(-1)!.below, 20);
  assert.ok(contextGaps(middle.model).at(-1)!.below > 0);
  const tail = await load("branch", "tail.ts");
  assert.equal(initialGaps(tail.diff.patch).at(-1)!.below, 0);
  assert.equal(contextGaps(tail.model).at(-1)!.below, 0);
  const header = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n";
  const noNewline = `@@ -1,6 +1,6 @@\n-a\n+b\n${" c\n".repeat(5)}\\ No newline at end of file\n`;
  assert.equal(initialGaps(header + noNewline).at(-1)!.below, 0);
  assert.equal(initialGaps(`${header}@@ -0,0 +1,2 @@\n+one\n+two\n`).at(-1)!.below, 0);
});
test("zero-count insertion/deletion hunks and multiple changes retain the correct old/new offsets", () => {
  const header = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n";
  const full = header + "@@ -1,4 +1,4 @@\n first\n+insert\n second\n-third\n last\n";
  const selected = header + "@@ -1,0 +2,1 @@\n+insert\n";
  let model = createContextModel(selected, full);
  assert.match(contextPatch(model), /@@ -1,0 \+2,1 @@/);
  model = expandContext(model, 0, "all");
  model = expandContext(model, 1, "below");
  assert.match(contextPatch(model), /@@ -1,2 \+1,3 @@/);
  assert.doesNotMatch(contextPatch(model), /-third/);
  const deletion = createContextModel(header + "@@ -3,1 +3,0 @@\n-third\n", full);
  assert.match(contextPatch(deletion), /@@ -3,1 \+3,0 @@/);
});
