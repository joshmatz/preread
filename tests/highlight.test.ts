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
