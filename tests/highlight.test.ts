import assert from "node:assert/strict";
import { test } from "node:test";
import { createTwoFilesPatch, structuredPatch, formatPatch } from "diff";
import { diffSyntax, highlightLines } from "../src/highlight.ts";

const comment = (html: string) =>
  html.startsWith('<span class="hljs-comment">') && html.endsWith("</span>");
const balanced = (html: string) => html.split("<span").length === html.split("</span>").length;

test("a clipped hunk gets its string and comment state from each version of the file", () => {
  const before = [
    "const prompt = `",
    "Read only.",
    "Use the available tools.",
    "Check the source.",
    "List the files you read.",
    "Summarize the result.",
    "Say what you could not confirm.",
    "`",
    "/** Returns the available tools. */",
    "export const tools = [read];",
  ].join("\n") + "\n";
  const after = before.replace("Read only.", "Read from the index.\nRead from the working tree.")
    .replace("[read]", "[read, search]");
  // Select the later hunk, as a grouped review or a chunk can do.
  const clipped = structuredPatch("a/tools.ts", "b/tools.ts", before, after, undefined, undefined, { context: 2 });
  assert.equal(clipped.hunks.length, 2);
  clipped.hunks.shift();
  assert.equal(diffSyntax(formatPatch(clipped)), undefined);

  const full = formatPatch(structuredPatch("a/tools.ts", "b/tools.ts", before, after, undefined, undefined, { context: Infinity }));
  const syntax = diffSyntax(full);
  assert.ok(syntax);
  const [{ oldStart, newStart }] = clipped.hunks;
  for (const [side, start] of [["old", oldStart], ["new", newStart]] as const) {
    const [close, doc, code] = syntax[side].slice(start - 1);
    assert.match(close.html, /^<span class="hljs-string">`<\/span>$/);
    assert.ok(comment(doc.html));
    assert.match(code.html, /^<span class="hljs-keyword">export<\/span>/);
  }
  assert.equal(syntax.old[oldStart + 1].text, "export const tools = [read];");
  assert.equal(syntax.new[newStart + 1].text, "export const tools = [read, search];");
});

test("edits inside a template literal stay string-colored across hidden lines", () => {
  const before = [
    "export const guide = `",
    "Options",
    "A person's pick makes one call.",
    "Keep the original option available.",
    "Summarize the result.",
    "Activity",
    "Record when the task ran.",
    "People can read the activity later.`;",
  ].join("\n") + "\n";
  const after = before.replace("one call", "every call with no step between them")
    .replace("Record when the task ran.", "Record each check with its answer.");
  const patch = (context: number) =>
    createTwoFilesPatch("a/guide.ts", "b/guide.ts", before, after, undefined, undefined, { context });
  assert.equal(diffSyntax(patch(1)), undefined);
  const syntax = diffSyntax(patch(Infinity));
  assert.ok(syntax);
  for (const side of ["old", "new"] as const) {
    for (const line of [3, 7]) {
      assert.match(syntax[side][line - 1].html, /^<span class="hljs-string">[^<]+<\/span>$/);
    }
  }
});

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

test("a call tree colors its code and leaves its prose plain", () => {
  const lines = highlightLines(
    [
      "openTodo({ orgId }) (the service) -> the new Todo's id",
      '  if assignee: invariant(todo) -> else not-found "Todo not found"',
      "  the org's claims, each 'open' if it is new",
    ],
    "call-tree",
  );
  assert.equal(
    lines[0],
    '<span class="hljs-section"><span class="hljs-title function_">openTodo</span>({ orgId }) <span class="hljs-comment">(the service)</span> <span class="hljs-symbol">-&gt;</span> the new Todo&#x27;s id</span>',
  );
  assert.equal(
    lines[1],
    '  <span class="hljs-keyword">if</span> assignee: <span class="hljs-title function_">invariant</span>(todo) <span class="hljs-symbol">-&gt;</span> <span class="hljs-keyword">else</span> <span class="hljs-type">not-found</span> <span class="hljs-string">&quot;Todo not found&quot;</span>',
  );
  assert.equal(lines[2], '  the org&#x27;s claims, each <span class="hljs-string">&#x27;open&#x27;</span> if it is new');
});

test("a call tree mutes a note whole, even around quoted code", () => {
  const [line] = highlightLines(
    ['  findTodo({ orgId }) (changed: now matches "findTodo({ orgId") (see findTodos) -> a Todo'],
    "call-tree",
  );
  assert.equal(
    line,
    '  <span class="hljs-title function_">findTodo</span>({ orgId }) <span class="hljs-comment">(<span class="hljs-keyword">changed</span>: now matches &quot;findTodo({ orgId&quot;)</span> <span class="hljs-comment">(see findTodos)</span> <span class="hljs-symbol">-&gt;</span> a Todo',
  );
});

test("a call tree note missing its parenthesis ends with its line", () => {
  const lines = highlightLines(["a() (existing", "  b()", "  c(x) -> d"], "call-tree");
  assert.match(lines[0], /hljs-comment/);
  assert.ok(lines.slice(1).every((line) => !/hljs-(?:comment|section)/.test(line)));
  assert.match(lines[1], /<span class="hljs-title function_">b<\/span>/);
});

test("a call tree mutes only what the outline treats as a note", () => {
  const lines = highlightLines(["  formatDate(value) (in UTC)", "  call(existing) (flow 3)"], "call-tree");
  assert.ok(lines.every((line) => !line.includes("hljs-comment")));
});
