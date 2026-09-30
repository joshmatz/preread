import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rename, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot, markGroup } from "../server/review.ts";
import { fileDiff } from "../server/git.ts";
import { putCollection } from "../server/collections.ts";
import type { Review } from "../src/review-types.ts";

let directory: string;
let repo: string;
let trace: string;
let review: Review;
const run = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "review-loading-")));
  repo = join(directory, "repo");
  trace = join(directory, "git.trace");
  process.env.PREREAD_DATA_DIR = join(directory, "metadata");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  run("config", "user.name", "Review Test");
  run("config", "user.email", "review@example.test");
  await writeFile(join(repo, "example.ts"), "before\n");
  await writeFile(join(repo, "old name.txt"), "one\ntwo\nthree\nfour\nfive\nsix\n");
  await writeFile(join(repo, "remove empty.txt"), "");
  run("add", ".");
  run("commit", "-m", "Base");
  run("switch", "-c", "feature");
  await writeFile(join(repo, "example.ts"), "after\n");
  await rename(join(repo, "old name.txt"), join(repo, "renamed.txt"));
  await rm(join(repo, "remove empty.txt"));
  await writeFile(join(repo, "[literal]\nname.ts"), "export const value = 1;\n");
  await writeFile(join(repo, "new empty.txt"), "");
  await writeFile(join(repo, "binary.bin"), Buffer.from([0, 1, 2]));
  run("add", ".");
  run("commit", "-m", "Changes");
  review = {
    id: "changes",
    title: "Changes",
    description: "",
    path: repo,
    base: "main",
    mode: "branch",
    groups: [
      {
        id: "example",
        title: "Example",
        description: "Explain the change",
        targets: [{ path: "example.ts" }],
      },
    ],
  };
  await putCollection({ id: "loading", title: "Loading", description: "", reviews: [review] });
});
after(async () => {
  delete process.env.GIT_TRACE;
  delete process.env.PREREAD_DATA_DIR;
  await rm(directory, { recursive: true, force: true });
});

test("simultaneous review and progress reads share one batch of patches with exact file contents", async () => {
  await writeFile(trace, "");
  process.env.GIT_TRACE = trace;
  const [first, second] = await Promise.all([
    snapshot(review, "loading"),
    snapshot(review, "loading"),
  ]);
  delete process.env.GIT_TRACE;
  assert.deepEqual(first, second);
  const commands = await readFile(trace, "utf8");
  assert.equal(commands.split("\n").filter((line) => line.includes(" --patch ")).length, 1);
  const previews = first.sections.flatMap((section) => section.files);
  assert.equal(previews.length, 5);
  for (const preview of previews) {
    const individual = await fileDiff(repo, "main", "branch", preview.file.path);
    assert.equal(preview.diff.patch, individual.patch, preview.file.path);
    assert.equal(preview.diff.binary, individual.binary, preview.file.path);
    assert.equal(preview.diff.tooLarge, individual.tooLarge, preview.file.path);
  }
});

test("cached branch content still checks refs and reads current descriptions and review receipts", async () => {
  const initial = await snapshot(review, "loading");
  await writeFile(trace, "");
  process.env.GIT_TRACE = trace;
  const marked = await markGroup(
    "loading",
    "changes",
    "example",
    initial.sections[0].fingerprint,
    true,
  );
  const current = await snapshot(review, "loading");
  const renamed = await snapshot(
    { ...review, groups: [{ ...review.groups[0], description: "A new explanation" }] },
    "loading",
  );
  delete process.env.GIT_TRACE;
  assert.equal(marked.sections[0].reviewed, true);
  assert.equal(current.sections[0].reviewed, true);
  assert.equal(renamed.sections[0].reviewed, false);
  assert.equal(renamed.sections[0].changedSinceReview, true);
  const commands = await readFile(trace, "utf8");
  assert.match(commands, /rev-parse/);
  assert.doesNotMatch(commands, /built-in: git diff /);
});

test("moving HEAD or the base invalidates cached content instead of hiding new changes", async () => {
  await writeFile(join(repo, "example.ts"), "newer\n");
  run("add", "example.ts");
  run("commit", "-m", "Newer change");
  const updated = await snapshot(review, "loading");
  assert.equal(updated.sections[0].changedSinceReview, true);
  assert.match(updated.sections[0].files[0].diff.patch, /\+newer/);
  run("branch", "-f", "main", "HEAD~1");
  const rebased = await snapshot(review, "loading");
  assert.equal(rebased.comparison.files.length, 1);
  assert.match(rebased.sections[0].files[0].diff.patch, /-after/);
});

test("mutable comparisons read fresh working files and staged content on every request", async () => {
  const local = { ...review, mode: "working" as const };
  await writeFile(join(repo, "example.ts"), "local-one\n");
  const first = await snapshot(local);
  await writeFile(join(repo, "example.ts"), "local-two\n");
  const second = await snapshot(local);
  assert.notEqual(first.sections[0].fingerprint, second.sections[0].fingerprint);
  assert.match(second.sections[0].files[0].diff.patch, /\+local-two/);
  run("add", "example.ts");
  const staged = await snapshot({ ...review, mode: "staged" });
  await writeFile(join(repo, "example.ts"), "local-new\n");
  run("add", "example.ts");
  const restaged = await snapshot({ ...review, mode: "staged" });
  assert.notEqual(staged.sections[0].fingerprint, restaged.sections[0].fingerprint);
  assert.match(restaged.sections[0].files[0].diff.patch, /\+local-new/);
});

test("invalid or option-like comparison bases cannot use a cached result", async () => {
  await assert.rejects(snapshot({ ...review, base: "does-not-exist" }), /valid base/);
  await assert.rejects(snapshot({ ...review, base: "--output=/tmp/file" }), /valid base/);
});
