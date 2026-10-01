import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { groupPreviews, snapshot, markGroup } from "../server/review.ts";
import {
  validateCollection,
  putCollection,
  readCollection,
  listCollections,
  setReceipt,
  readReceipts,
} from "../server/collections.ts";
import { reviewContent } from "../server/patches.ts";
import type { Collection, FilePreview, ChangeGroup } from "../src/review-types.ts";

const patch =
  "diff --git a/example.ts b/example.ts\nindex 1111111..2222222 100644\n--- a/example.ts\n+++ b/example.ts\n@@ -1,2 +1,2 @@\n-old first\n+new first\n context\n@@ -40,2 +40,2 @@\n-old second\n+new second\n context\n";
const preview: FilePreview = {
  file: { path: "example.ts", status: "M", additions: 2, deletions: 2, binary: false },
  partial: false,
  diff: { patch, hash: "fixture", binary: false, tooLarge: false, empty: false },
};
const group: ChangeGroup = {
  id: "first-change",
  title: "First decision",
  description: "Review one part of the file.",
  targets: [{ path: "example.ts", ranges: [{ side: "new", start: 1, end: 1 }] }],
};
const scope = { id: "example", path: "/tmp/repository", base: "main", mode: "branch" as const };
const collection: Collection = {
  id: "fixture",
  title: "Local review",
  description: "A collection is not a stack.",
  reviews: [{ ...scope, title: "Example", description: "", groups: [group] }],
};
let directory: string;
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "review-groups-")));
  process.env.PREREAD_DATA_DIR = join(directory, "metadata");
});
after(async () => {
  delete process.env.PREREAD_DATA_DIR;
  await rm(directory, { recursive: true, force: true });
});

test("line ranges select complete change blocks while unmatched blocks stay visible", () => {
  const result = groupPreviews([preview], [group], {}, scope);
  assert.equal(result.length, 2);
  assert.equal(result[0].files[0].partial, true);
  assert.match(result[0].files[0].diff.patch, /new first/);
  assert.doesNotMatch(result[0].files[0].diff.patch, /new second/);
  assert.match(result[1].files[0].diff.patch, /new second/);
  assert.equal(result[1].id, "other-changes");
});
test("old-side ranges select deletions and context-only ranges do not accidentally claim a change", () => {
  const result = groupPreviews(
    [preview],
    [
      {
        ...group,
        targets: [{ path: "example.ts", ranges: [{ side: "old", start: 40, end: 40 }] }],
      },
    ],
    {},
    scope,
  );
  assert.match(result[0].files[0].diff.patch, /old second/);
  const missing = groupPreviews(
    [preview],
    [{ ...group, targets: [{ path: "example.ts", ranges: [{ side: "new", start: 2, end: 2 }] }] }],
    {},
    scope,
  );
  assert.equal(missing[0].canReview, false);
  assert.match(missing[0].warnings[0], /no longer match/);
  assert.equal(missing[1].files[0].partial, false);
});
test("review receipts survive changes in an unrelated block of the same file", () => {
  const first = groupPreviews([preview], [group], {}, scope)[0];
  const receipts = {
    "example/first-change": { fingerprint: first.fingerprint, reviewedAt: "2026-09-20T00:00:00Z" },
  };
  const unrelated = {
    ...preview,
    diff: {
      ...preview.diff,
      patch: patch.replace("2222222", "3333333").replace("new second", "different second"),
    },
  };
  assert.equal(groupPreviews([unrelated], [group], receipts, scope)[0].reviewed, true);
  const changed = {
    ...preview,
    diff: { ...preview.diff, patch: patch.replace("new first", "different first") },
  };
  const result = groupPreviews([changed], [group], receipts, scope)[0];
  assert.equal(result.reviewed, false);
  assert.equal(result.changedSinceReview, true);
  assert.equal(
    groupPreviews([preview], [{ ...group, description: "Different decision" }], receipts, scope)[0]
      .reviewed,
    false,
  );
});
test("receipts cover text after a carriage return or line separator", () => {
  for (const separator of ["\r", "\u2028", "\u2029"]) {
    const edited = (value: string) => `${patch}+safe${separator}index ${value}\n`;
    assert.notEqual(reviewContent(edited("1")), reviewContent(edited("2")));
  }
});
test("overlapping and missing assignments stay visible and cannot be silently marked reviewed", () => {
  const result = groupPreviews(
    [preview],
    [
      group,
      { ...group, id: "overlap" },
      { ...group, id: "missing", targets: [{ path: "missing.ts" }] },
    ],
    {},
    scope,
  );
  assert.equal(result[1].canReview, false);
  assert.match(result[1].warnings[0], /earlier group/);
  assert.equal(result[2].canReview, false);
  assert.match(result[2].warnings[0], /no longer/);
});
test("metadata-only changes remain in the review and unavailable previews block completion", () => {
  const modeChange = {
    ...preview,
    diff: {
      ...preview.diff,
      patch: "diff --git a/example.ts b/example.ts\nold mode 100644\nnew mode 100755\n",
    },
  };
  const result = groupPreviews(
    [modeChange],
    [{ ...group, targets: [{ path: "example.ts" }] }],
    {},
    scope,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].canReview, true);
  assert.equal(
    groupPreviews([{ ...preview, error: "Cannot load diff" }], [group], {}, scope)[0].canReview,
    false,
  );
});
test("image previews can complete a group and their receipts follow the image content", () => {
  const binary = (index: string, image?: FilePreview["diff"]["image"]): FilePreview => ({
    file: { path: "logo.png", status: "M", additions: 0, deletions: 0, binary: true },
    partial: false,
    diff: {
      patch: `diff --git a/logo.png b/logo.png\nindex ${index} 100644\nBinary files a/logo.png and b/logo.png differ\n`,
      hash: index,
      binary: true,
      tooLarge: false,
      empty: false,
      image,
    },
  });
  const whole = [{ ...group, targets: [{ path: "logo.png" }] }];
  const image = { old: { size: 10 }, new: { size: 12 } };
  const first = groupPreviews([binary("1111111..2222222", image)], whole, {}, scope)[0];
  assert.equal(first.canReview, true);
  assert.equal(groupPreviews([binary("1111111..2222222")], whole, {}, scope)[0].canReview, false);
  const replaced = groupPreviews([binary("1111111..3333333", image)], whole, {}, scope)[0];
  assert.notEqual(replaced.fingerprint, first.fingerprint);
  assert.notEqual(replaced.files[0].viewHash, first.files[0].viewHash);
});
test("a binary file moved without content changes can complete a group", () => {
  const moved: FilePreview = {
    file: {
      path: "fonts/brand/Inter.woff2",
      oldPath: "fonts/Inter.woff2",
      status: "R",
      additions: 0,
      deletions: 0,
      binary: true,
    },
    partial: false,
    diff: {
      patch:
        "diff --git a/fonts/Inter.woff2 b/fonts/brand/Inter.woff2\nsimilarity index 100%\nrename from fonts/Inter.woff2\nrename to fonts/brand/Inter.woff2\n",
      hash: "moved",
      binary: true,
      tooLarge: false,
      empty: false,
    },
  };
  const whole = [{ ...group, targets: [{ path: "fonts/brand/Inter.woff2" }] }];
  assert.equal(groupPreviews([moved], whole, {}, scope)[0].canReview, true);
});
test("a block keeps its view hash when other blocks of its file change or move it", () => {
  const views = (text: string) =>
    groupPreviews([{ ...preview, diff: { ...preview.diff, patch: text } }], [group], {}, scope).map(
      (section) => section.files[0].viewHash,
    );
  const [first, second] = views(patch);
  const [, shifted] = views(
    patch
      .replace("1111111..2222222", "1111111..3333333")
      .replace(
        "@@ -1,2 +1,2 @@\n-old first\n+new first\n",
        "@@ -1,2 +1,3 @@\n-old first\n+new first\n+added\n",
      )
      .replace("@@ -40,2 +40,2 @@", "@@ -40,2 +41,2 @@"),
  );
  assert.equal(shifted, second);
  const [unchanged, edited] = views(patch.replace("new second", "different second"));
  assert.equal(unchanged, first);
  assert.notEqual(edited, second);
});
test("a renamed file's blocks and receipts ignore its similarity score", () => {
  const renamed = (similarity: number, text: string): FilePreview => ({
    ...preview,
    file: { ...preview.file, oldPath: "old.ts", status: "R" },
    diff: {
      ...preview.diff,
      patch: text.replace(
        "index ",
        `similarity index ${similarity}%\nrename from old.ts\nrename to example.ts\nindex `,
      ),
    },
  });
  const before = groupPreviews([renamed(96, patch)], [group], {}, scope);
  const after = groupPreviews(
    [renamed(95, patch.replace("new second", "different second"))],
    [group],
    {},
    scope,
  );
  assert.equal(after[0].files[0].viewHash, before[0].files[0].viewHash);
  assert.equal(after[0].fingerprint, before[0].fingerprint);
  assert.notEqual(after[1].files[0].viewHash, before[1].files[0].viewHash);
});
test("identical blocks in one file keep separate view hashes", () => {
  const block = (line: number) => `@@ -${line},2 +${line},2 @@\n-old\n+new\n context\n`;
  const header = patch.slice(0, patch.indexOf("@@"));
  const twice = { ...preview, diff: { ...preview.diff, patch: header + block(1) + block(40) } };
  const [first, second] = groupPreviews([twice], [group], {}, scope);
  assert.equal(second.id, "other-changes");
  assert.notEqual(first.files[0].viewHash, second.files[0].viewHash);
});
test("a file without hunks keeps its view hash when it moves from Other changes into a group", () => {
  const renamed: FilePreview = {
    file: { path: "b.txt", oldPath: "a.txt", status: "R", additions: 0, deletions: 0, binary: false },
    partial: false,
    diff: {
      patch: "diff --git a/a.txt b/b.txt\nsimilarity index 100%\nrename from a.txt\nrename to b.txt\n",
      hash: "renamed",
      binary: false,
      tooLarge: false,
      empty: false,
    },
  };
  const other = groupPreviews([preview, renamed], [group], {}, scope).at(-1)!;
  const grouped = groupPreviews([renamed], [{ ...group, targets: [{ path: "b.txt" }] }], {}, scope);
  const moved = other.files.find((file) => file.file.path === "b.txt")!;
  assert.ok(moved.viewHash);
  assert.equal(grouped[0].files[0].viewHash, moved.viewHash);
});
test("collection validation rejects traversal, malformed ranges, duplicate IDs and reserved groups", () => {
  assert.throws(() => validateCollection({ ...collection, id: "../outside" }));
  assert.throws(
    () =>
      validateCollection({
        ...collection,
        reviews: [collection.reviews[0], collection.reviews[0]],
      }),
    /Duplicate/,
  );
  for (const targets of [
    [],
    [{ path: "../secret" }],
    [{ path: "./example.ts" }],
    [{ path: "example.ts", range: [{ side: "new", start: 1, end: 1 }] }],
    [{ path: "example.ts", ranges: [] }],
    [{ path: "example.ts", ranges: [{ side: "new", start: 8, end: 2 }] }],
  ]) {
    assert.throws(() =>
      validateCollection({
        ...collection,
        reviews: [{ ...collection.reviews[0], groups: [{ ...group, targets }] }],
      }),
    );
  }
  assert.throws(
    () =>
      validateCollection({
        ...collection,
        reviews: [{ ...collection.reviews[0], groups: [{ ...group, id: "other-changes" }] }],
      }),
    /reserved/,
  );
  assert.throws(
    () => validateCollection({ ...collection, reviews: [{ ...collection.reviews[0], group: [] }] }),
    /Unknown field “group” in reviews\[0\]/,
  );
  assert.throws(
    () => validateCollection({ ...collection, reviews: [{ ...collection.reviews[0], base: " " }] }),
    /needs a base/,
  );
});
test("an unreadable collection file does not hide the other collections", async () => {
  await putCollection(collection);
  const broken = join(directory, "metadata", "collections", "broken.json");
  await writeFile(broken, "{");
  const ids = (await listCollections()).map((entry) => entry.id);
  await rm(broken);
  assert.equal(ids.includes("fixture"), true);
});
test("importing descriptions preserves user review receipts and concurrent writes preserve both groups", async () => {
  await putCollection(collection);
  await Promise.all([
    setReceipt("fixture", "example", "first-change", "one"),
    setReceipt("fixture", "example", "second-change", "two"),
  ]);
  await putCollection({ ...collection, title: "Renamed collection" });
  assert.equal((await readCollection("fixture")).title, "Renamed collection");
  assert.equal(Object.keys(await readReceipts("fixture")).length, 2);
  await setReceipt("fixture", "example", "first-change", null);
  assert.equal(Object.keys(await readReceipts("fixture")).length, 1);
});
test("real Git reviews persist completion, reject stale marks, and invalidate changed content without touching the repository", async () => {
  const repo = join(directory, "fixture repository");
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  run("config", "user.name", "Review Test");
  run("config", "user.email", "review@example.test");
  await writeFile(join(repo, "example.ts"), "old\n");
  run("add", ".");
  run("commit", "-m", "Base");
  await writeFile(join(repo, "example.ts"), "new\n");
  const review = {
    ...collection.reviews[0],
    path: repo,
    mode: "working" as const,
    groups: [{ ...group, targets: [{ path: "example.ts" }] }],
  };
  await putCollection({ ...collection, id: "integration", reviews: [review] });
  const status = run("status", "--porcelain");
  const index = await readFile(join(repo, ".git/index"));
  const initial = await snapshot(review, "integration");
  assert.equal(initial.sections[0].reviewed, false);
  const marked = await markGroup(
    "integration",
    "example",
    "first-change",
    initial.sections[0].fingerprint,
    true,
  );
  assert.equal(marked.sections[0].reviewed, true);
  assert.equal((await snapshot(review, "integration")).sections[0].reviewed, true);
  assert.equal(run("status", "--porcelain"), status);
  assert.deepEqual(await readFile(join(repo, ".git/index")), index);
  await writeFile(join(repo, "example.ts"), "different\n");
  await assert.rejects(
    markGroup("integration", "example", "first-change", initial.sections[0].fingerprint, true),
    /changed/,
  );
  assert.equal((await snapshot(review, "integration")).sections[0].changedSinceReview, true);
});
