import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeNotes, migrateNotes } from "../src/notes.ts";
import { memoryStorage } from "./memory-storage.ts";

test("notes from earlier bases of a checkout join under its file without losing text", () => {
  assert.deepEqual(
    mergeNotes(
      { "/repo|same.ts": "Rename the helper.", "/repo|cleared.ts": "" },
      {
        "/repo|main|branch|same.ts": "Rename the helper.\n",
        "/repo|main|branch|short.ts": "TODO",
        "/repo|abc123|all|short.ts": "Remove the TODO comment.",
        "/repo|main|branch|both.ts": "First thought.",
        "/repo|origin/main|all|both.ts": "Second thought.",
        "/repo|HEAD|working|both.ts": "First thought.",
        "~/notes||working|odd|name.md": "Pipes stay in file names.",
        "/repo|main|branch|empty.ts": "  ",
      },
    ),
    {
      "/repo|same.ts": "Rename the helper.",
      "/repo|short.ts": "TODO\n\nRemove the TODO comment.",
      "/repo|both.ts": "First thought.\n\nSecond thought.",
      "~/notes|odd|name.md": "Pipes stay in file names.",
    },
  );
});
test("the old notes record moves into file notes once", () => {
  const { storage, items } = memoryStorage({
    notes: JSON.stringify({ "/repo|main|branch|a.ts": "Old note." }),
    "file-notes": JSON.stringify({ "/repo|b.ts": "New note." }),
  });
  const expected = { "/repo|a.ts": "Old note.", "/repo|b.ts": "New note." };
  migrateNotes(storage);
  assert.equal(items.has("notes"), false);
  assert.deepEqual(JSON.parse(items.get("file-notes")!), expected);
  migrateNotes(storage);
  assert.deepEqual(JSON.parse(items.get("file-notes")!), expected);
});
