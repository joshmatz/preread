import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rename, symlink, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  repository,
  comparison,
  fileDiff,
  stackFor,
  resolveRef,
  parseStatuses,
} from "../server/git.ts";

let directory: string;
let repo: string;
let child: string;
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "worktree-review-test-")));
  repo = join(directory, "repository with spaces");
  run(directory, "init", "-b", "main", repo);
  run(repo, "config", "user.email", "local-review@example.test");
  run(repo, "config", "user.name", "Local Review Test");
  await writeFile(join(repo, "unchanged.txt"), "stable\n");
  await writeFile(join(repo, "[literal].txt"), "before\n");
  await writeFile(join(repo, "rename me.txt"), "one\ntwo\nthree\nfour\nfive\nsix\n");
  await writeFile(join(repo, "edited.ts"), "export const count = 1\n");
  run(repo, "add", ".");
  run(repo, "commit", "-m", "Base");
  child = join(directory, "feature worktree");
  run(repo, "worktree", "add", "-b", "feature", child);
  await writeFile(join(child, "edited.ts"), "export const count = 2\n");
  await rename(join(child, "rename me.txt"), join(child, "renamed.txt"));
  run(child, "add", ".");
  run(child, "commit", "-m", "Feature");
  await writeFile(join(repo, "base-only.txt"), "This belongs only to main\n");
  run(repo, "add", ".");
  run(repo, "commit", "-m", "Independent base work");
  await writeFile(join(child, "edited.ts"), "export const count = 3\n");
  run(child, "add", "edited.ts");
  await writeFile(join(child, "edited.ts"), "export const count = 4\n");
  await writeFile(join(child, "new notes.md"), "# Private local note\nSecond line\n");
  await writeFile(join(child, "new.bin"), Buffer.from([0, 1, 2]));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("discovers worktrees with spaces and keeps the selected checkout identity", async () => {
  const result = await repository(child);
  assert.equal(result.branch, "feature");
  assert.equal(result.dirty, true);
  assert.equal(result.worktrees.length, 2);
  assert.equal(result.worktrees.find((tree) => tree.branch === "feature")?.path, child);
});
test("branch comparison uses the merge base and excludes unrelated base and local changes", async () => {
  const result = await comparison(child, "main", "branch");
  assert.equal(result.commitCount, 1);
  assert.equal(result.commits[0].subject, "Feature");
  assert.deepEqual(result.files.map((file) => file.path).sort(), ["edited.ts", "renamed.txt"]);
  assert.equal(result.files.find((file) => file.path === "renamed.txt")?.oldPath, "rename me.txt");
  const diff = await fileDiff(child, "main", "branch", "edited.ts");
  assert.match(diff.patch, /\+export const count = 2/);
  assert.doesNotMatch(diff.patch, /count = 4/);
});
test("staged mode separates the index from later working-tree edits", async () => {
  const result = await comparison(child, "main", "staged");
  assert.deepEqual(
    result.files.map((file) => file.path),
    ["edited.ts"],
  );
  const diff = await fileDiff(child, "main", "staged", "edited.ts");
  assert.match(diff.patch, /\+export const count = 3/);
  assert.doesNotMatch(diff.patch, /count = 4/);
});
test("working mode includes untracked files and reads the final local edit", async () => {
  const result = await comparison(child, "main", "working");
  assert.equal(result.files.find((file) => file.path === "new notes.md")?.untracked, true);
  assert.equal(
    result.files.some((file) => file.path === "renamed.txt"),
    false,
  );
  const diff = await fileDiff(child, "main", "working", "edited.ts");
  assert.match(diff.patch, /-export const count = 2/);
  assert.match(diff.patch, /\+export const count = 4/);
});
test("combined mode includes both committed and local files", async () => {
  const result = await comparison(child, "main", "all");
  assert.equal(result.files.length, 4);
  const diff = await fileDiff(child, "main", "all", "edited.ts");
  assert.match(diff.patch, /-export const count = 1/);
  assert.match(diff.patch, /\+export const count = 4/);
});
test("untracked text and binary files produce appropriate previews", async () => {
  const text = await fileDiff(child, "main", "working", "new notes.md");
  assert.match(text.patch, /\+# Private local note/);
  const binary = await fileDiff(child, "main", "working", "new.bin");
  assert.equal(binary.binary, true);
  assert.equal(binary.patch, "");
});
test("renames remain one file with both original and new paths", async () => {
  const result = await fileDiff(child, "main", "branch", "renamed.txt");
  assert.match(result.patch, /rename from rename me.txt/);
  assert.match(result.patch, /rename to renamed.txt/);
});
test("rejects arbitrary filesystem reads and option-like refs", async () => {
  await assert.rejects(fileDiff(child, "main", "working", "../secret.txt"), /not part of/);
  await assert.rejects(fileDiff(child, "main", "working", "unchanged.txt"), /not part of/);
  await assert.rejects(resolveRef(child, "--output=/tmp/file"));
});
test("does not follow an untracked symlink outside the repository", async () => {
  await writeFile(join(directory, "outside.txt"), "Outside content");
  await symlink(join(directory, "outside.txt"), join(child, "outside-link"));
  await assert.rejects(fileDiff(child, "main", "working", "outside-link"), /symlink/);
  await rm(join(child, "outside-link"));
});
test("reading changes leaves HEAD, index, and working files untouched", async () => {
  const head = run(child, "rev-parse", "HEAD");
  const status = run(child, "status", "--porcelain=v1");
  const indexPath = run(child, "rev-parse", "--git-path", "index");
  const index = await readFile(indexPath);
  await comparison(child, "main", "all");
  await fileDiff(child, "main", "all", "edited.ts");
  assert.equal(run(child, "rev-parse", "HEAD"), head);
  assert.equal(run(child, "status", "--porcelain=v1"), status);
  assert.deepEqual(await readFile(indexPath), index);
});
test("stack shows actual ancestry rather than treating diverged worktrees as parents", async () => {
  run(child, "branch", "stack-parent", "HEAD~1");
  const parent = join(directory, "parent worktree");
  run(repo, "worktree", "add", parent, "stack-parent");
  const result = await stackFor(child);
  assert.equal(result.find((node) => node.branch === "feature")?.relation, "current");
  assert.equal(result.find((node) => node.branch === "stack-parent")?.relation, "ancestor");
  assert.equal(
    result.some((node) => node.branch === "main"),
    false,
  );
});
test("NUL-delimited status parsing preserves unusual filenames", () => {
  const result = parseStatuses("M\0tab\tand\nnewline.txt\0R100\0old name\0new name\0");
  assert.equal(result[0].path, "tab\tand\nnewline.txt");
  assert.equal(result[1].oldPath, "old name");
  assert.equal(result[1].path, "new name");
});

test("Git metacharacters in a filename are treated literally", async () => {
  await writeFile(join(child, "[literal].txt"), "after\n");
  const diff = await fileDiff(child, "main", "working", "[literal].txt");
  assert.match(diff.patch, /\+after/);
  assert.match(diff.patch, /-before/);
});
