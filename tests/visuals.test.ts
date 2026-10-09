import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { putCollection, readCollection, validateCollection, setReceipt, readReceipts, dataDirectory } from "../server/collections.ts";
import { readVisual } from "../server/review-visuals.ts";
import { storeVisual, visualAsset, MAX_VISUAL_BYTES } from "../server/visual-assets.ts";
import { snapshot } from "../server/review.ts";
import type { Collection } from "../src/review-types.ts";
let directory: string;
let repo: string;
let image: string;
let manifest: Collection;
const svg = (text: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text x="5" y="20">${text}</text></svg>`);
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "preread-visuals-")));
  repo = join(directory, "repo"); image = join(directory, "flow.svg");
  process.env.PREREAD_DATA_DIR = join(directory, "metadata");
  await mkdir(repo); git("init", "-b", "main"); git("config", "user.name", "QA"); git("config", "user.email", "qa@example.test");
  await writeFile(join(repo, "code.ts"), "old\n"); git("add", "."); git("commit", "-m", "Base");
  await writeFile(join(repo, "code.ts"), "new\n"); await writeFile(image, svg("request flow"));
  manifest = { id: "visuals", title: "Visuals", description: "", reviews: [{ id: "change", title: "Change", description: "", path: repo, base: "", mode: "working",
    visuals: [{ id: "overview", title: "Overview", path: image }],
    groups: [{ id: "code", title: "Code", description: "", targets: [{ path: "code.ts" }],
      visuals: [{ id: "flow", title: "Request flow", path: image, caption: "What the group does." }] }] }] };
});
after(async () => { delete process.env.PREREAD_DATA_DIR; await rm(directory, { recursive: true, force: true }); });
test("imports copy both visual scopes outside the repository and preserve receipts", async () => {
  const status = git("status", "--porcelain");
  await setReceipt("visuals", "change", "code", "existing");
  const saved = await putCollection(manifest);
  const stored = saved.reviews[0].visuals![0].path;
  assert.ok(stored.startsWith(join(dataDirectory(), "visuals")));
  assert.equal(saved.reviews[0].groups[0].visuals![0].path, stored);
  assert.equal((await readReceipts("visuals"))["change/code"].fingerprint, "existing");
  assert.equal(git("status", "--porcelain"), status);
  const section = (await snapshot(saved.reviews[0], "visuals")).sections[0];
  assert.equal(section.visuals![0].caption, "What the group does.");
  const withNoVisuals = { ...saved.reviews[0], groups: [{ ...saved.reviews[0].groups[0], visuals: undefined }] };
  assert.equal((await snapshot(withNoVisuals, "visuals")).sections[0].fingerprint, section.fingerprint,
    "optional context does not silently change code reading checkpoints");
  await rm(image);
  assert.deepEqual((await readVisual("visuals", "change", "", "overview")).content, svg("request flow"));
  await writeFile(image, svg("updated flow"));
  const next = await putCollection(manifest);
  assert.notEqual(next.reviews[0].visuals![0].path, stored);
  assert.deepEqual((await visualAsset(stored, dataDirectory())).content, svg("request flow"));
});
test("attachments are scoped to the declared review and group", async () => {
  await assert.rejects(readVisual("visuals", "change", "code", "overview"), /not attached/);
  await assert.rejects(readVisual("visuals", "change", "missing", "flow"), /not in/);
  await assert.rejects(readVisual("visuals", "missing", "", "overview"), /not in/);
  await assert.rejects(visualAsset(image, dataDirectory()), /not a stored/);
});
test("visual manifests reject remote, unsupported, duplicate and excessive entries", () => {
  const visual = manifest.reviews[0].visuals![0];
  for (const entries of [[{ ...visual, path: "https://example.test/a.svg" }], [{ ...visual, path: "/tmp/a.html" }],
    [visual, visual], Array.from({ length: 13 }, (_, index) => ({ ...visual, id: `v${index}` })),
    [{ ...visual, url: image }]])
    assert.throws(() => validateCollection({ ...manifest, reviews: [{ ...manifest.reviews[0], visuals: entries }] }));
});
test("attachment storage rejects oversized, disguised and tampered images", async () => {
  await assert.rejects(storeVisual(Buffer.alloc(MAX_VISUAL_BYTES + 1), "huge.png", dataDirectory()), /10 MB/);
  await assert.rejects(storeVisual(Buffer.from("<html>bad</html>"), "fake.png", dataDirectory()), /format/);
  await assert.rejects(storeVisual(Buffer.from("plain"), "fake.svg", dataDirectory()), /format/);
  const stored = await storeVisual(svg("original"), "tamper.svg", dataDirectory());
  await writeFile(stored, svg("changed"));
  await assert.rejects(visualAsset(stored, dataDirectory()), /changed unexpectedly/);
  await rm(stored); await symlink(image, stored);
  await assert.rejects(visualAsset(stored, dataDirectory()), /outside/);
});

test("Mermaid attachments copy source, normalize extensions and reject invalid text", async () => {
  const source = Buffer.from("flowchart LR\n  Reader --> Review\n");
  const path = await storeVisual(source, "flow.mermaid", dataDirectory());
  assert.match(path, /\.mmd$/);
  const asset = await visualAsset(path, dataDirectory());
  assert.equal(asset.type, "text/plain"); assert.deepEqual(asset.content, source);
  await assert.rejects(storeVisual(Buffer.alloc(65537, 65), "big.mmd", dataDirectory()), /64 KB/);
  await assert.rejects(storeVisual(Buffer.from([255, 254, 0]), "bad.mmd", dataDirectory()), /UTF-8/);
  await assert.rejects(storeVisual(Buffer.from("\0"), "bad.mmd", dataDirectory()), /nonempty/);
});
