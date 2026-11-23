import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pathLanguage } from "../src/highlight.ts";
import { CommentText, plainText } from "../src/Markdown.tsx";

const render = (text: string, language?: string) => renderToStaticMarkup(createElement(CommentText, { className: "code-comment-body", language, children: text }));

test("a comment's code blocks take syntax colors, and one without a language takes its file's", () => {
  const named = render("Try this:\n\n```python\ndef ready():\n    return True\n```");
  assert.match(named, /<pre><code class="hljs language-python"><span class="hljs-keyword">def<\/span>/);
  const unnamed = "```\nconst ready = true;\n```";
  assert.match(render(unnamed, pathLanguage("src/App.tsx")), /<code class="hljs language-typescript"><span class="hljs-keyword">const<\/span>/);
  assert.match(render(unnamed), /<pre><code>const ready = true;\n<\/code><\/pre>/);
  assert.match(render("Rename `openMenu` to **toggleMenu**."), /<code>openMenu<\/code> to <strong>toggleMenu<\/strong>/);
});

test("a comment keeps its line breaks, and text that looks like HTML", () => {
  const html = render("First line\nsecond line\n\nShould this return Promise<void>? <script>alert(1)</script>");
  assert.match(html, /<p>First line\nsecond line<\/p>/);
  assert.match(html, /Promise&lt;void&gt;\? &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<void/);
});

test("a comment links to an image instead of loading it, and drops unsafe links", () => {
  const html = render("![The failing screen](https://example.com/shot.png) [Bad](javascript:alert(1))");
  assert.match(html, /<a href="https:\/\/example.com\/shot.png" target="_blank" rel="noreferrer">The failing screen<\/a>/);
  assert.doesNotMatch(html, /<img|javascript:/);
});

test("a comment's preview is its text without the Markdown", () => {
  assert.equal(plainText("Use `openMenu()` here:\n\n```ts\nopenMenu();\n```\n\n- **One**\n- Two"), "Use openMenu() here:\nopenMenu();\nOne\nTwo");
  assert.equal(plainText("Returns Promise<void>"), "Returns Promise<void>");
});
