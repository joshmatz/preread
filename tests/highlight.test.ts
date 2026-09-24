import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightLines } from "../src/highlight.ts";

const comment = (html: string) =>
  html.startsWith('<span class="hljs-comment">') && html.endsWith("</span>");
const balanced = (html: string) => html.split("<span").length === html.split("</span>").length;

test("every line of a doc comment is highlighted as a comment", () => {
  const lines = highlightLines(
    [
      "/**",
      " * Returns the items for the user, if any.",
      " * @param id - the user's id",
      " */",
      "export const items = (id: string) => [];",
    ],
    "typescript",
  );
  assert.equal(lines.length, 5);
  assert.ok(lines.slice(0, 4).every(comment));
  assert.match(lines[2], /<span class="hljs-doctag">@param<\/span>/);
  assert.match(lines[4], /^<span class="hljs-keyword">export<\/span>/);
  assert.ok(lines.every(balanced));
});

test("a hunk that starts inside a doc comment keeps its prose out of the code", () => {
  const lines = highlightLines(
    ["", " * Stops if the user's session ended.", " */", "function stop() {}"],
    "typescript",
  );
  assert.equal(lines.length, 4);
  assert.ok(lines.slice(1, 3).every(comment));
  assert.match(lines[3], /^<span class="hljs-keyword">function<\/span>/);
});

test("code lines that start with an asterisk are not treated as a comment", () => {
  const lines = highlightLines(["  * rate", "  return total;"], "typescript");
  assert.ok(!lines.some((line) => line.includes("hljs-comment")));
  assert.ok(!highlightLines([" * item", " */"], "python").some((line) => line.includes("comment")));
});

test("spans that cross lines are reopened in nesting order", () => {
  const lines = highlightLines(["const a = `x ${", "  b", "} y`;"], "typescript");
  assert.match(lines[1], /^<span class="hljs-string"><span class="hljs-subst">/);
  assert.ok(lines.every(balanced));
});
