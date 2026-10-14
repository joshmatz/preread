import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  putCollection,
  readCollection,
  readImage,
  saveImages,
  validateCollection,
} from "../server/collections.ts";
import { groupPreviews } from "../server/review.ts";
import type { CollectionImage } from "../src/review-types.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const group = {
  id: "row",
  title: "Transactions row",
  description: "",
  targets: [{ path: "row.tsx" }],
};
const review = {
  id: "payments",
  title: "Payment details",
  description: "",
  path: "/tmp/repository",
  base: "main",
  mode: "branch" as const,
  groups: [group],
};
const manifest = (images: unknown[]) => ({
  id: "images",
  title: "Images",
  description: "",
  reviews: [{ ...review, images }],
});
let directory: string;
let screenshot: string;
before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "collection-images-")));
  process.env.PREREAD_DATA_DIR = join(directory, "data");
  screenshot = join(directory, "Shot.PNG");
  await writeFile(screenshot, png);
  await mkdir(join(directory, "folder.png"));
  await writeFile(join(directory, "error-page.png"), "<html><body>Link expired</body></html>");
  await writeFile(join(directory, "huge.png"), "");
  await truncate(join(directory, "huge.png"), 21 * 1024 * 1024);
});
after(async () => {
  delete process.env.PREREAD_DATA_DIR;
  await rm(directory, { recursive: true, force: true });
});

test("import saves images by content, so the original can go and later imports keep them", async () => {
  const caption = "Check · 1042 under the Manual payment title";
  const link = "https://www.figma.com/design/abc/Billing?node-id=1-2";
  await putCollection(await saveImages(manifest([{ path: screenshot, caption, link }])));
  const saved = await readCollection("images");
  const [image] = saved.reviews[0].images!;
  assert.match(image.file, /^[0-9a-f]{64}\.png$/);
  assert.deepEqual(image, { file: image.file, caption, link });
  assert.deepEqual(await readImage(image.file), { content: png, type: "image/png" });
  assert.deepEqual(await readFile(join(directory, "data", "images", image.file)), png);
  await rm(screenshot);
  await putCollection(await saveImages(structuredClone(saved)));
  assert.deepEqual(await readCollection("images"), saved);
  await writeFile(screenshot, png);
});
test("collections and groups take images too, and a blank caption is dropped", async () => {
  await putCollection(
    await saveImages({
      ...manifest([]),
      images: [{ path: screenshot }],
      reviews: [{ ...review, groups: [{ ...group, images: [{ path: screenshot, caption: " " }] }] }],
    }),
  );
  const saved = await readCollection("images");
  assert.equal(saved.reviews[0].images, undefined);
  assert.deepEqual(saved.reviews[0].groups[0].images, saved.images);
  assert.deepEqual(Object.keys(saved.images![0]), ["file"]);
});
test("images don’t reopen a reviewed group", () => {
  const fingerprint = (images?: CollectionImage[]) =>
    groupPreviews([], [{ ...group, ...(images ? { images } : {}) }], {}, review)[0].fingerprint;
  assert.equal(fingerprint([{ file: `${"a".repeat(64)}.png` }]), fingerprint());
});
test("import rejects images it can’t save, with their place in the manifest", async () => {
  const cases: [unknown, RegExp][] = [
    [{ path: "shots/row.png" }, /reviews\[0\]\.images\[0\] needs an absolute image path/],
    [{ path: join(directory, "row.svg") }, /must be a PNG, JPEG/],
    [{ path: join(directory, "missing.png") }, /no image file at/],
    [{ path: join(directory, "folder.png") }, /no image file at/],
    [{ path: join(directory, "error-page.png") }, /error-page\.png isn’t an image/],
    [{ path: join(directory, "huge.png") }, /over the 20 MB image limit/],
    [{ path: screenshot, caption: "x".repeat(1001) }, /images\[0\] caption \(at most 1,000/],
    ["/tmp/shot.png", /Expected an object for reviews\[0\]\.images\[0\]/],
    [{ path: screenshot, file: `${"b".repeat(64)}.png` }, /a path or a file, not both/],
    [{ file: `${"c".repeat(64)}.png` }, /no saved image/],
    [{ path: screenshot, alt: "Row" }, /Unknown field “alt” in reviews\[0\]\.images\[0\]/],
    [{ path: screenshot, link: "javascript:alert(1)" }, /http or https/],
  ];
  for (const [image, error] of cases)
    await assert.rejects(async () => putCollection(await saveImages(manifest([image]))), error);
  const relative = [{ path: "row.png" }];
  await assert.rejects(
    saveImages({ ...manifest([]), images: relative }),
    /^Error: images\[0\] needs an absolute image path/,
  );
  await assert.rejects(
    saveImages({ ...manifest([]), reviews: [{ ...review, groups: [{ ...group, images: relative }] }] }),
    /reviews\[0\]\.groups\[0\]\.images\[0\] needs an absolute image path/,
  );
});
test("a rejected import copies no images", async () => {
  const saved = () => readdir(join(directory, "data", "images")).catch(() => []);
  const before = await saved();
  const fresh = join(directory, "fresh.png");
  await writeFile(fresh, Buffer.concat([png, Buffer.from("fresh")]));
  const cases: [unknown, RegExp][] = [
    [manifest(Array(21).fill({ path: fresh })), /reviews\[0\]\.images list \(at most 20\)/],
    [{ ...manifest([{ path: fresh }]), title: " " }, /title is required/],
  ];
  for (const [input, error] of cases) await assert.rejects(saveImages(input), error);
  assert.deepEqual(await saved(), before);
});
test("only import reads an image path, and saved names can't leave the image folder", async () => {
  assert.throws(
    () => validateCollection(manifest([{ path: screenshot }])),
    /Unknown field “path”/,
  );
  for (const name of ["../collections/images.json", `${"d".repeat(64)}.svg`, "row.png"])
    await assert.rejects(readImage(name), /Invalid image name/);
  await assert.rejects(readImage(`${"e".repeat(64)}.png`), /no longer saved/);
});
