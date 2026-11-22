import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CallTree, initialOpen, openForMarks } from "../src/CallTree.tsx";
import { Markdown } from "../src/Markdown.tsx";
import { parseCallTree, type CallTreePart, type CallTreeStep } from "../src/call-tree.ts";

const tree = [
  "createTodo(input) (the service)",
  "  findAccount(id) (existing)",
  '    -> else not-found "Account not found"',
  "  insertTodo(row) (PR 1 todo-record; changed)",
  "    insertTodoEvent({ todoId }) (below)",
  "  if todo.done: notify(todo) (see insertTodo)",
  "",
  "insertTodoEvent({ todoId })",
  "  db.insert(events)",
].join("\n");

const text = (html: string) => html.replace(/<[^>]*>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const parts = (step: CallTreeStep) => step.pieces.flatMap((piece) => piece.kind === "note" ? piece.items.map((item) => item.part) : []);
const code = (step: CallTreeStep) => step.pieces.map((piece) => piece.kind === "code" ? piece.text : "[note]").join("");

test("a call tree's steps nest by their indentation", () => {
  const parsed = parseCallTree(tree);
  assert.deepEqual(parsed.roots.map(code), ["createTodo(input) [note]", "insertTodoEvent({ todoId })"]);
  assert.deepEqual(parsed.steps.map((step) => step.depth), [0, 1, 2, 1, 2, 1, 0, 1]);
  assert.deepEqual(parsed.roots[0].children.map(code), ["findAccount(id) [note]", "insertTodo(row) [note]", "if todo.done: notify(todo) [note]"]);
  assert.equal(parsed.steps[2].parent, parsed.steps[1]);
});

test("a note that starts with a known word becomes marks", () => {
  const [service, existing, , insert] = parseCallTree(tree).steps;
  assert.deepEqual(parts(service), [{ kind: "mark", label: "the service", changed: false, separator: "", detail: "" }]);
  assert.deepEqual(parts(existing), [{ kind: "mark", label: "existing", changed: false, separator: "", detail: "" }]);
  assert.deepEqual(parts(insert).map((part) => part.kind === "mark" && [part.label, part.changed]), [["PR 1 todo-record", false], ["changed", true]]);
});

test("above, below and see point at the step that shows that call's own steps", () => {
  const parsed = parseCallTree(tree);
  const [below] = parts(parsed.steps[4]) as Array<Extract<CallTreePart, { kind: "link" }>>;
  assert.equal(below.name, "insertTodoEvent");
  assert.equal(below.target, parsed.roots[1]);
  const [see] = parts(parsed.steps[5]) as Array<Extract<CallTreePart, { kind: "link" }>>;
  assert.equal(see.name, "insertTodo");
  assert.equal(see.target, parsed.steps[3]);
  const [missing] = parts(parseCallTree("a() (see nothingHere)\nb()").steps[0]) as Array<Extract<CallTreePart, { kind: "link" }>>;
  assert.equal(missing.target, undefined);
  const member = parseCallTree('foo.bar()\n  wrong()\nfoo()\n  right()\ncaller() (see foo)\nf("(") (below)');
  const [seeFoo, quoted] = [member.steps[4], member.steps[5]].map((step) => parts(step)[0] as Extract<CallTreePart, { kind: "link" }>);
  assert.equal(seeFoo.target, member.steps[2]);
  assert.equal(quoted.name, "f");
});

test("a same-as note with no call before it goes to the nearest copy that shows its steps", () => {
  const parsed = parseCallTree(["if !canUse(req): -> 403", "  canUse(req)", "a()", "  if !canUse(req): -> 403 (above)", "b()", "  if !canUse(req): -> 403 (above)"].join("\n"));
  const [link] = parts(parsed.steps[5]) as Array<Extract<CallTreePart, { kind: "link" }>>;
  assert.equal(link.target, parsed.steps[0]);
});

test("a parenthesis inside a string is never a note, the same as in the colors", () => {
  assert.deepEqual(parseCallTree("say('a (existing) thing')").steps[0].pieces, [{ kind: "code", text: "say('a (existing) thing')" }]);
  assert.deepEqual(parts(parseCallTree('resize(img) -> a 5" thumbnail (changed)').steps[0]).map((part) => part.kind === "mark" && part.label), ["changed"]);
  assert.deepEqual(parts(parseCallTree("run() (existing, PR 12 todo-api)").steps[0]).map((part) => part.kind === "mark" && part.label), ["existing", "PR 12 todo-api"]);
});

test("other parentheses stay part of the step", () => {
  for (const line of ["formatDate(value) (in UTC)", "call(existing)", 'say("a (existing) thing")', "a() (existing"])
    assert.deepEqual(parseCallTree(line).steps[0].pieces, [{ kind: "code", text: line }]);
});

test("a note can explain itself, with parentheses and quotes inside", () => {
  const [changed] = parts(parseCallTree("pick(todo) (changed: fingerprint <> claimFingerprint('c') (PR 1 todo-record))").steps[0]);
  assert.deepEqual(changed, { kind: "mark", label: "changed", changed: true, separator: ": ",
    detail: "fingerprint <> claimFingerprint('c') (PR 1 todo-record)" });
  const items = parseCallTree('run() (the service: PR 1 todo-record; changed in PR 2 todo-api, see run)').steps[0].pieces[1];
  assert.equal(items.kind, "note");
  assert.deepEqual(items.kind === "note" && items.items.map(({ before, part }) => [before, part.kind, part.kind === "text" ? part.text : part.label]),
    [["(", "mark", "the service"], ["; ", "mark", "changed in PR 2 todo-api"], [", ", "link", "see run"]]);
});

test("the outline's text is the source on unusual input too", () => {
  for (const source of ["", "\n\n", "a()\n\tb()\n\n  c() (existing)  \n", "  starts indented\nroot\n", 'x (above) (below) ("quoted (existing)")\n',
    "a() (changed: x (PR 1 a); see b) (existing, PR 12 todo-api)\n  b() (above)"])
    assert.equal(text(renderToStaticMarkup(createElement(CallTree, { code: source }))), source);
});

test("the outline's text is the source, so comments anchor the same in either view", () => {
  const html = renderToStaticMarkup(createElement(CallTree, { code: tree, textId: "call-tree" }));
  assert.equal(text(html), tree);
  assert.match(html, /data-brief-text="call-tree"/);
  assert.match(html, /<button type="button" class="call-tree-link" data-label="↓ insertTodoEvent" aria-label="Go to insertTodoEvent, below"/);
  assert.match(html, /<span class="call-tree-mark changed">changed<\/span>/);
  assert.match(html, /<span class="hljs-title function_">findAccount<\/span>/);
  assert.match(html, /aria-label="1 line under insertTodo\(row\)"/);
});

test("each step is colored alone, so a note missing its parenthesis mutes only its own line", () => {
  const html = renderToStaticMarkup(createElement(CallTree, { code: "a() (existing\n  b()" }));
  assert.match(html, /<span class="hljs-comment">\(existing<\/span>/);
  assert.match(html, /<span class="hljs-title function_">b<\/span>/);
  assert.doesNotMatch(html, /hljs-section/);
});

test("the outline opens each level while it stays short, and every step a comment holds", () => {
  const wide = ["root()", ...Array.from({ length: 40 }, (_, index) => `  call${index}()\n    inner${index}()\n      deep${index}()`)].join("\n");
  const parsed = parseCallTree(wide);
  assert.deepEqual([...initialOpen(parsed)], [0]);
  const deep = parsed.steps.find((step) => code(step) === "deep7()");
  assert.ok(deep);
  assert.deepEqual([...openForMarks(parsed, [[deep.start + 1, deep.start + 3]])].sort((a, b) => a - b), [0, deep.parent!.parent!.id, deep.parent!.id]);
  assert.deepEqual([...initialOpen(parseCallTree(tree))].sort((a, b) => a - b), [0, 1, 3, 6]);
});

test("a call-tree fence in Markdown shows the outline", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { children: "Before\n\n```call-tree\nfoo() (existing)\n  bar()\n```\n" }));
  assert.match(html, /<div class="call-tree">/);
  assert.doesNotMatch(html, /<pre/);
  assert.equal(text(html), "Before\nfoo() (existing)\n  bar()\n");
  const other = renderToStaticMarkup(createElement(Markdown, { children: "```typescript\nconst ready = true;\n```" }));
  assert.match(other, /^<div class="markdown"><pre><code class="hljs language-typescript">/);
});
