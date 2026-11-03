import { test } from "node:test";
import assert from "node:assert/strict";
import { byFolder, fitPath } from "../src/outline-folders.ts";

const file = (path: string) => ({ file: { path } });

test("files gather under their folder in first-seen order, even when Git's order interleaves them", () => {
  const groups = byFolder(
    ["README.md", "src/App.tsx", "src/components/Button.tsx", "src/style.css", "package.json"].map(file),
  );
  assert.deepEqual(
    groups.map(({ folder, files }) => [folder, files.map(({ file }) => file.path)]),
    [
      ["", ["README.md", "package.json"]],
      ["src", ["src/App.tsx", "src/style.css"]],
      ["src/components", ["src/components/Button.tsx"]],
    ],
  );
});

test("a long folder loses whole leading folders, never part of a name", () => {
  const measure = (text: string) => text.length;
  const path = "packages/delivery/src/webhooks/retries";
  assert.equal(fitPath(path, 40, measure), path);
  assert.equal(fitPath(path, 31, measure), "…/delivery/src/webhooks/retries");
  assert.equal(fitPath(path, 30, measure), "…/src/webhooks/retries");
  assert.equal(fitPath(path, 20, measure), "…/webhooks/retries");
  assert.equal(fitPath(path, 3, measure), "…/retries");
});
