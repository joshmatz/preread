import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Description } from "../src/Description.tsx";
import { Markdown } from "../src/Markdown.tsx";

test("a description renders Markdown", () => {
  const html = renderToStaticMarkup(createElement(Description, {
    text: "Problem: `<Picker>` drops **every** filter.\nSolution: it keeps them.\n\n> \"keep my filters\" (Josh, 2026-11-23)",
  }));
  assert.match(html, /<div class="description-text"><div class="markdown"><p>Problem: <code>&lt;Picker&gt;<\/code> drops <strong>every<\/strong> filter.\nSolution: it keeps them.<\/p>/);
  assert.match(html, /<blockquote>\n<p>&quot;keep my filters&quot; \(Josh, 2026-11-23\)<\/p>\n<\/blockquote>/);
});

test("Markdown shows text that looks like HTML as typed", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { children: "Each request reads user:<id>:roleChangedAt. <script>alert(1)</script>" }));
  assert.match(html, /user:&lt;id&gt;:roleChangedAt\. &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<id/);
});
