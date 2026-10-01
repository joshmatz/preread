import assert from "node:assert/strict";
import { test } from "node:test";
import { noContentNote, pathDiff, type PathPart } from "../src/change-notes.ts";

test("renamed paths mark only the folders and name parts that changed", () => {
  const show = (parts: PathPart[]) =>
    parts.map(({ text, changed }) => (changed ? `[${text}]` : text)).join("");
  const marked = (from: string, to: string) => {
    const { before, after } = pathDiff(from, to);
    return `${show(before)} → ${show(after)}`;
  };
  assert.equal(marked("src/util.ts", "src/lib/util.ts"), "src/util.ts → src/[lib/]util.ts");
  assert.equal(marked("src/lib/util.ts", "src/util.ts"), "src/[lib/]util.ts → src/util.ts");
  assert.equal(marked("README.md", "docs/README.md"), "README.md → [docs/]README.md");
  assert.equal(marked("docs/notes.txt", "docs/notes.md"), "docs/notes[.txt] → docs/notes[.md]");
  assert.equal(marked("Readme.md", "README.md"), "[Readme].md → [README].md");
  assert.equal(
    marked("src/check.ts", "test/check.test.ts"),
    "[src/]check.ts → [test/]check[.test].ts",
  );
  assert.equal(marked("src/strings.ts", "lib/text.ts"), "[src/strings].ts → [lib/text].ts");
  assert.equal(marked("my.lib/a.ts", "my.lib/b.ts"), "my.lib/[a].ts → my.lib/[b].ts");
});

test("patches without hunks say what changed instead of looking empty", () => {
  const header = (lines: string[]) => `diff --git a/x b/y\n${lines.join("\n")}\n`;
  assert.equal(
    noContentNote(header(["similarity index 100%", "rename from x", "rename to y"])),
    "No content changes.",
  );
  assert.equal(
    noContentNote(header(["old mode 100644", "new mode 100755"])),
    "File mode changed from 100644 to 100755. No content changes.",
  );
  assert.equal(
    noContentNote(header(["new file mode 100644", "index 0000000..e69de29"])),
    "Empty file.",
  );
  assert.equal(
    noContentNote(header(["deleted file mode 100644", "index e69de29..0000000"])),
    "Empty file.",
  );
  assert.equal(
    noContentNote(header(["index 9b0adbd..2d79ad6 100644", "Binary files a/x and b/y differ"])),
    "",
  );
  const edit = ["index 5aba804..9e8ef46", "--- a/x", "+++ b/y", "@@ -1 +1 @@", "-a", "+b"];
  assert.equal(noContentNote(header(edit)), "");
  assert.equal(noContentNote(""), "");
});
