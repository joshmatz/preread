import { test } from "node:test";
import assert from "node:assert/strict";
import { currentKey, fileViewed, migrateMarks, setFilesCollapsed } from "../src/useFileState.ts";
import { memoryStorage } from "./memory-storage.ts";

const hash = "0123456789abcdef".repeat(4);

test("only collapse preferences migrate from older comparison keys", () => {
  const viewedKey = `file-viewed:/repo|main|branch|src/a.ts|${hash}`;
  const collapsedKey = `file-collapsed:/repo|main|branch|src/a.ts|${hash}`;
  const current = `file-collapsed:/repo|src/a.ts|${hash}`;
  assert.equal(currentKey(viewedKey), undefined);
  assert.equal(currentKey(collapsedKey), current);
  assert.equal(currentKey(current), undefined);
  const { storage, items } = memoryStorage({ [viewedKey]: "true", [collapsedKey]: "false", theme: "dark" });
  migrateMarks(storage);
  assert.deepEqual(Object.fromEntries(items), { [viewedKey]: "true", [current]: "false", theme: "dark" });
});

test("server Viewed state wins over browser marks and group receipt fallbacks", () => {
  const file = { path: "src/a.ts", viewHash: hash, patchHash: hash };
  setFilesCollapsed("/repo", [file], true);
  assert.equal(fileViewed({ ...file, viewed: false }, true), false);
  assert.equal(fileViewed({ ...file, viewed: true }), true);
  assert.equal(fileViewed(file), false);
  assert.equal(fileViewed(file, true), true);
});

test("bulk UI updates write collapse preferences without persisting Viewed marks", () => {
  const { storage, items } = memoryStorage();
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  try {
    setFilesCollapsed("/fresh-repo", [{ path: "a.ts", viewHash: hash, patchHash: hash }], true);
    assert.deepEqual(Object.fromEntries(items), { [`file-collapsed:/fresh-repo|a.ts|${hash}`]: "true" });
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
