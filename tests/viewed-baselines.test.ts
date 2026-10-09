import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, realpath, rm, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot, viewedFile, markGroup } from "../server/review.ts";
import { putCollection, readReceipts, setReceipt } from "../server/collections.ts";
import type { Review, FilePreview, SinceViewed, ViewedBaselineInfo } from "../src/review-types.ts";

let directory: string;
let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
const review = (id: string, path: string, mode: Review["mode"] = "working"): Review => ({
  id, path: repo, title: id, description: "", base: "main", mode,
  groups: [{ id: "code", title: "Code", description: "", targets: [{ path }] }],
});
const preview = async (scope: Review, collection?: string) =>
  (await snapshot(scope, collection)).sections[0].files[0];
const call = (scope: Review, file: FilePreview, save: boolean, collection?: string, group = "code") =>
  viewedFile(scope, group, file.file.path, file.contextHash ?? file.diff.hash, file.viewHash!, save, collection);
const delta = async (scope: Review, collection?: string) =>
  await call(scope, await preview(scope, collection), false, collection) as SinceViewed;
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "preread-baselines-")));
  repo = join(directory, "repo");
  process.env.PREREAD_DATA_DIR = join(directory, "metadata");
  await mkdir(repo);
  git("init", "-b", "main");
  git("config", "user.name", "Baseline Test");
  git("config", "user.email", "baseline@example.test");
  for (const name of ["code.ts", "staged.ts", "bulk.ts", "partial.ts", "old.txt"])
    await writeFile(join(repo, name), name === "partial.ts" ? "base first\n" + "context\n".repeat(40) + "base last\n" : "base\n");
  git("add", "."); git("commit", "-m", "Base");
});
after(async () => { delete process.env.PREREAD_DATA_DIR; await rm(directory, { recursive: true, force: true }); });

test("a Viewed baseline shows only subsequent edits and never writes a group receipt", async () => {
  const scope = review("individual", "code.ts");
  await writeFile(join(repo, "code.ts"), "viewed code\n");
  assert.equal((await delta(scope)).available, false);
  const before = git("status", "--porcelain");
  const head = git("rev-parse", "HEAD");
  const index = git("write-tree");
  const saved = await call(scope, await preview(scope), true) as ViewedBaselineInfo;
  assert.equal(saved.hasText, true);
  assert.equal(git("status", "--porcelain"), before);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("write-tree"), index);
  assert.deepEqual(await readReceipts("individual"), {});
  assert.equal((await delta(scope)).diff?.empty, true);
  await writeFile(join(repo, "code.ts"), "updated code\n");
  const current = await snapshot(scope);
  assert.equal(current.sections[0].changedSinceReview, true);
  const result = await delta(scope);
  assert.equal(result.reviewedAt, saved.reviewedAt);
  assert.match(result.diff!.patch, /-viewed code\n\+updated code/);
  assert.doesNotMatch(result.diff!.patch, /-base/);
  await call(scope, await preview(scope), true);
  assert.equal((await delta(scope)).diff?.empty, true);
  assert.equal((await snapshot(scope)).sections[0].changedSinceReview, false);
});

test("stale and out-of-comparison requests cannot replace a saved baseline", async () => {
  const scope = review("stale", "code.ts");
  const old = await preview(scope);
  await call(scope, old, true);
  await writeFile(join(repo, "code.ts"), "changed after loading\n");
  await assert.rejects(call(scope, old, true), /changed since/);
  const result = await delta(scope);
  assert.match(result.diff!.patch, /-updated code/);
  await assert.rejects(viewedFile(scope, "code", "../outside", "hash", "hash", true), /not part/);
  const fresh = await preview(scope);
  await assert.rejects(viewedFile(scope, "missing", "code.ts", fresh.contextHash ?? fresh.diff.hash, "hash", true), /selected blocks/);
});

test("staged baselines use index content and ignore later working edits", async () => {
  const scope = review("staged", "staged.ts", "staged");
  await writeFile(join(repo, "staged.ts"), "viewed staged\n"); git("add", "staged.ts");
  await writeFile(join(repo, "staged.ts"), "later working edit\n");
  await call(scope, await preview(scope), true);
  assert.equal((await delta(scope)).diff!.empty, true);
  await writeFile(join(repo, "staged.ts"), "updated staged\n"); git("add", "staged.ts");
  await writeFile(join(repo, "staged.ts"), "unrelated working content\n");
  const result = await delta(scope);
  assert.match(result.diff!.patch, /-viewed staged\n\+updated staged/);
  assert.doesNotMatch(result.diff!.patch, /working/);
});

test("bulk Viewed clicks save baselines and old hash-only receipts are explicit", async () => {
  const scope = review("bulk", "bulk.ts");
  await writeFile(join(repo, "bulk.ts"), "bulk viewed\n");
  await putCollection({ id: "bulk", title: "Bulk", description: "", reviews: [scope] });
  const current = await snapshot(scope, "bulk");
  await markGroup("bulk", "bulk", "code", current.sections[0].fingerprint, true);
  await writeFile(join(repo, "bulk.ts"), "bulk updated\n");
  assert.match((await delta(scope, "bulk")).diff!.patch, /-bulk viewed\n\+bulk updated/);
  assert.equal((await delta({ ...scope, mode: "all" }, "bulk")).available, false,
    "changing comparison scope does not reuse a different viewed baseline");
  await putCollection({ id: "hash-only", title: "Old receipt", description: "", reviews: [scope] });
  await setReceipt("hash-only", "bulk", "code", current.sections[0].fingerprint);
  assert.equal((await delta(scope, "hash-only")).available, false);
  assert.equal((await delta(scope, "another-collection")).available, false,
    "a baseline never leaks between collections with matching review IDs");
});

test("partial groups have separate viewing times and whole-file comparisons", async () => {
  const scope = review("partial", "partial.ts");
  scope.groups[0].targets[0].ranges = [{ side: "new", start: 1, end: 1 }];
  await writeFile(join(repo, "partial.ts"), "viewed first\n" + "context\n".repeat(40) + "viewed last\n");
  const full = await snapshot(scope);
  const first = full.sections[0].files[0];
  const other = full.sections.find((section) => section.id === "other-changes")!.files.find((file) => file.file.path === "partial.ts")!;
  assert.ok(first.partial);
  assert.ok(other.partial);
  await call(scope, first, true);
  assert.equal((await call(scope, other, false, undefined, "other-changes") as SinceViewed).available, false);
  await writeFile(join(repo, "partial.ts"), "updated first\n" + "context\n".repeat(40) + "updated last\n");
  const result = await delta(scope);
  assert.match(result.diff!.patch, /-viewed first/);
  assert.match(result.diff!.patch, /-viewed last/);
});

test("untracked files retain exact final-newline changes and unsupported binaries are explicit", async () => {
  const scope = review("newline", "new.ts");
  await writeFile(join(repo, "new.ts"), "no newline");
  await call(scope, await preview(scope), true);
  await writeFile(join(repo, "new.ts"), "no newline\n");
  const result = await delta(scope);
  assert.match(result.diff!.patch, /No newline at end of file/);
  const binary = review("binary", "file.bin");
  await writeFile(join(repo, "file.bin"), Buffer.from([0, 1]));
  const saved = await call(binary, await preview(binary), true) as ViewedBaselineInfo;
  assert.equal(saved.hasText, false);
  assert.equal((await delta(binary)).available, false);
});

test("rename-only baselines capture real content even when the original patch has no hunks", async () => {
  await rename(join(repo, "old.txt"), join(repo, "renamed.txt"));
  git("add", "old.txt", "renamed.txt");
  const scope = review("rename", "renamed.txt", "staged");
  const first = await preview(scope);
  assert.equal(first.file.status, "R");
  await call(scope, first, true);
  await writeFile(join(repo, "renamed.txt"), "renamed updated\n"); git("add", "renamed.txt");
  assert.match((await delta(scope)).diff!.patch, /-base\n\+renamed updated/);
});


test("working symlinks stay viewable without reading their targets", async () => {
  await symlink("/outside/should-never-be-read", join(repo, "link.txt"));
  const scope = review("symlink", "link.txt");
  const saved = await call(scope, await preview(scope), true) as ViewedBaselineInfo;
  assert.equal(saved.hasText, false);
  assert.equal((await delta(scope)).available, false);
});


test("branch baselines use committed content and deletions compare against the viewed text", async () => {
  await writeFile(join(repo, "branch.ts"), "base branch\n");
  git("add", "branch.ts"); git("commit", "-m", "Branch base");
  git("branch", "baseline-base");
  await writeFile(join(repo, "branch.ts"), "viewed branch\n");
  git("add", "branch.ts"); git("commit", "-m", "Viewed branch");
  const scope = { ...review("branch", "branch.ts", "branch"), base: "baseline-base" };
  await writeFile(join(repo, "branch.ts"), "uncommitted ignored\n");
  await call(scope, await preview(scope), true);
  assert.equal((await delta(scope)).diff!.empty, true);
  await writeFile(join(repo, "branch.ts"), "updated branch\n");
  git("add", "branch.ts"); git("commit", "-m", "Updated branch");
  assert.match((await delta(scope)).diff!.patch, /-viewed branch\n\+updated branch/);
  const working = review("delete", "branch.ts");
  await writeFile(join(repo, "branch.ts"), "viewed before delete\n");
  await call(working, await preview(working), true);
  await rm(join(repo, "branch.ts"));
  assert.match((await delta(working)).diff!.patch, /-viewed before delete/);
});


test("a TTF can complete a group and new font bytes invalidate its viewed mark", async () => {
  const scope = review("font", "font.ttf");
  await writeFile(join(repo, "font.ttf"), Buffer.from([0, 1, 0, 0, 1]));
  await putCollection({ id: "font", title: "Font", description: "", reviews: [scope] });
  const first = await snapshot(scope, "font");
  assert.equal(first.sections[0].canReview, true);
  const marked = await markGroup("font", "font", "code", first.sections[0].fingerprint, true);
  assert.equal(marked.sections[0].reviewed, true);
  assert.equal(marked.sections[0].files[0].lastViewed!.hasText, false);
  await writeFile(join(repo, "font.ttf"), Buffer.from([0, 1, 0, 0, 2]));
  const next = await snapshot(scope, "font");
  assert.equal(next.sections[0].reviewed, false);
  assert.equal(next.sections[0].changedSinceReview, true);
  assert.notEqual(next.sections[0].files[0].viewHash, first.sections[0].files[0].viewHash);
  assert.equal((await delta(scope, "font")).available, false);
});
