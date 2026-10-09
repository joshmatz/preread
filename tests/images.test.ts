import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rename, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileDiff, fileImage } from "../server/git.ts";
import { adHocReview, snapshot } from "../server/review.ts";
import type { Mode } from "../src/types.ts";

let directory: string;
let repo: string;
const run = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const png = (seed: number) => Buffer.concat([pixel, Buffer.from([seed])]);
const read = async (mode: Mode, file: string, side: string) =>
  fileImage(repo, "main", mode, file, side, (await fileDiff(repo, "main", mode, file)).hash);
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "review-images-")));
  repo = join(directory, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  run("config", "user.name", "Image Test");
  run("config", "user.email", "review@example.test");
  await writeFile(join(repo, "logo.png"), png(1));
  await writeFile(join(repo, "removed.png"), png(2));
  await writeFile(join(repo, "move me.png"), png(3));
  await writeFile(join(repo, "linked.png"), png(12));
  run("add", ".");
  run("commit", "-m", "Base");
  run("switch", "-c", "feature");
  await writeFile(join(repo, "logo.png"), png(4));
  await rm(join(repo, "removed.png"));
  await rename(join(repo, "move me.png"), join(repo, "moved.png"));
  await writeFile(join(repo, "added.png"), png(5));
  await writeFile(join(repo, "archive.bin"), Buffer.from([0, 1, 2]));
  await rm(join(repo, "linked.png"));
  await symlink("logo.png", join(repo, "linked.png"));
  run("add", ".");
  run("commit", "-m", "Images");
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("changed images preview each version that exists and can complete a group", async () => {
  const images = ["logo.png", "added.png", "removed.png", "moved.png"];
  const { sections } = await snapshot({
    ...adHocReview(repo, "main", "branch"),
    groups: [
      { id: "images", title: "Images", description: "", targets: images.map((path) => ({ path })) },
    ],
  });
  const size = { size: png(0).length };
  assert.deepEqual(
    Object.fromEntries(sections[0].files.map((preview) => [preview.file.path, preview.diff.image])),
    {
      "logo.png": { old: size, new: size },
      "added.png": { new: size },
      "removed.png": { old: size },
      "moved.png": { old: size, new: size },
    },
  );
  assert.equal(sections[0].canReview, true);
  const logo = sections[0].files[0];
  const loaded = await fileImage(repo, "main", "branch", "logo.png", "new", logo.contextHash!);
  assert.deepEqual(loaded.content, png(4));
  assert.deepEqual(
    sections[1].files.map((preview) => [
      preview.file.path,
      preview.diff.binary,
      preview.diff.image,
    ]),
    [
      ["archive.bin", true, undefined],
      ["linked.png", true, undefined],
    ],
  );
  assert.equal(sections[1].canReview, true, "non-image binaries can be inspected locally and acknowledged");
});
test("the image endpoint reads each version from Git with its content type", async () => {
  assert.deepEqual(await read("branch", "logo.png", "old"), { content: png(1), type: "image/png" });
  assert.deepEqual(await read("branch", "logo.png", "new"), { content: png(4), type: "image/png" });
  assert.deepEqual((await read("branch", "moved.png", "old")).content, png(3));
  await assert.rejects(read("branch", "added.png", "old"), /can't be previewed/);
  await assert.rejects(read("branch", "archive.bin", "new"), /can't be previewed/);
  await assert.rejects(read("branch", "linked.png", "old"), /can't be previewed/);
  await assert.rejects(read("branch", "logo.png", "both"), /old or new/);
  await assert.rejects(fileImage(repo, "main", "branch", "../logo.png", "new", ""), /not part of/);
});
test("local images read the version under review and refuse stale reads", async () => {
  await writeFile(join(repo, "logo.png"), png(6));
  await writeFile(join(repo, "draft.png"), png(7));
  assert.deepEqual((await read("all", "logo.png", "old")).content, png(1));
  assert.deepEqual((await read("all", "logo.png", "new")).content, png(6));
  assert.deepEqual((await read("working", "draft.png", "new")).content, png(7));
  const draft = await fileDiff(repo, "main", "working", "draft.png");
  assert.match(draft.patch, /Binary files \/dev\/null and b\/draft\.png differ/);
  await writeFile(join(repo, "draft.png"), png(8));
  assert.notEqual((await fileDiff(repo, "main", "working", "draft.png")).hash, draft.hash);
  await assert.rejects(
    fileImage(repo, "main", "working", "draft.png", "new", draft.hash),
    /changed since/,
  );
  await writeFile(join(repo, "1:icon.png"), png(9));
  run("add", "logo.png", "1:icon.png");
  await writeFile(join(repo, "logo.png"), png(10));
  assert.deepEqual((await read("staged", "logo.png", "old")).content, png(4));
  assert.deepEqual((await read("staged", "logo.png", "new")).content, png(6));
  assert.deepEqual((await read("staged", "1:icon.png", "new")).content, png(9));
});
test("untracked images preview beyond the text patch limit", async () => {
  const large = Buffer.alloc(3 * 1024 * 1024);
  await writeFile(join(repo, "large.png"), large);
  await writeFile(join(repo, "large.bin"), large);
  const image = await fileDiff(repo, "main", "working", "large.png");
  assert.equal(image.binary, true);
  assert.equal(image.tooLarge, false);
  assert.equal((await fileDiff(repo, "main", "working", "large.bin")).tooLarge, true);
});
test("an untracked symlink named like an image is never followed", async () => {
  await writeFile(join(directory, "outside.png"), png(11));
  await symlink(join(directory, "outside.png"), join(repo, "link.png"));
  await assert.rejects(read("working", "link.png", "new"), /regular file/);
  const { sections } = await snapshot(adHocReview(repo, "main", "working"));
  const link = sections[0].files.find((preview) => preview.file.path === "link.png");
  assert.equal(link?.diff.image, undefined);
});
