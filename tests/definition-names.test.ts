import assert from "node:assert/strict";
import { test } from "node:test";
import { definitionNames } from "../src/definition-names.ts";

const names = (source: string) => definitionNames(source).map(({ name, call }) => call ? name + "()" : name);

test("every name in code can be followed, but not words in strings, comments or regular expressions", () => {
  assert.deepEqual(names([
    "const label = `row ${LIMIT + offset} of ${count(items)}`; // a comment with words",
    'const re = /["a-z]+/g, ratio = total / size / 2;',
    "/* a block",
    "   comment */ export const shown = \"Don't follow this\";",
    "const nested = `outer ${`inner ${deep}`} tail`;",
  ].join("\n")), [
    "label", "LIMIT", "offset", "count()", "items",
    "re", "ratio", "total", "size",
    "shown",
    "nested", "deep",
  ]);
});

test("keywords are skipped, except as properties", () => {
  assert.deepEqual(names("if (value.catch) promise.catch(async error => { throw error; });\nlet x = this.default as Options;"), [
    "value", "catch", "promise", "catch()", "error", "error", "x", "default", "Options",
  ]);
});

test("type names can be followed where a library exports them, as valibot does string()", () => {
  assert.deepEqual(names('const schema = object({ name: string(), count: number() });\nconst [line, number] = key.split(":");'), [
    "schema", "object()", "name", "string()", "count", "number()", "line", "number", "key", "split()",
  ]);
});

test("JSX names, props and expressions can be followed, and its closing tags don't start a regular expression", () => {
  assert.deepEqual(names('<Child value={total}>{a}</Child><b>{c}</b>;\nreturn /x/.test(y) ? <br /> : null;'), [
    "Child", "value", "total", "a", "Child", "b", "c", "b", "test()", "y", "br",
  ]);
});

test("JSX text is prose, so its apostrophes, slashes and URLs don't hide the expressions after them", () => {
  assert.deepEqual(names([
    "const view = <p>Don't {format(value)}, it's {a / b} or {c}/{d}: https://example.com</p>;",
    "return (",
    '  <Note tone="info">',
    "    Don't upload {kind} files.",
    "  </Note>",
    ");",
  ].join("\n")), [
    "view", "p", "format()", "value", "a", "b", "c", "d", "p",
    "Note", "tone", "kind", "Note",
  ]);
});

test("type parameters aren't JSX, and plain .ts has no JSX at all", () => {
  assert.deepEqual(names("const pick = <T,>(items: T[]) => items[0];\nconst id = <T extends object>(x: T) => x;\nconst fn: <T>(x: T) => T = id;\n<Tip>{fn}</Tip>;"), [
    "pick", "T", "items", "T", "items",
    "id", "T", "object", "x", "T", "x",
    "fn", "T", "x", "T", "T", "id",
    "Tip", "fn", "Tip",
  ]);
  assert.deepEqual(definitionNames("const cast = <Options>value;\nconst f = <T>(x: T) => x;", false).map(({ name }) => name), [
    "cast", "Options", "value", "f", "T", "x", "T", "x",
  ]);
});

test("a template that spans lines ends where its backtick does", () => {
  assert.deepEqual(names("const text = `a\nb`; finish();"), ["text", "finish()"]);
});

test("a tag, template or comment that never closes was misread, so the code after it still counts", () => {
  assert.deepEqual(names("const id = <const T,>(x: T) => x;\nfinish();"), ["id", "T", "x", "T", "x", "finish()"]);
  assert.deepEqual(names("if (ready) /[/*]/.test(value);\nfinish();"), ["ready", "test()", "value", "finish()"]);
  assert.deepEqual(names("const text = `first\nfinish();"), ["text", "first", "finish()"]);
});

test("a string continued onto the next line, even with Windows line endings, is one string", () => {
  assert.deepEqual(names('const text = "first \\\r\n`second";\nfinish();'), ["text", "finish()"]);
});

test("a generic component's type arguments stay inside its tag", () => {
  assert.deepEqual(names("const view = <div><Select<Item> value={selected} /></div>;\nfinish();"), [
    "view", "div", "Select", "Item", "value", "selected", "div", "finish()",
  ]);
});

test("a slash after a non-null assertion or an increment divides", () => {
  assert.deepEqual(names("const ratio = total! / divisor / scale + index++ / count;"), [
    "ratio", "total", "divisor", "scale", "index", "count",
  ]);
});

test("private fields and minified lines have nothing to follow", () => {
  assert.deepEqual(names("this.#size = size;\n" + "a".repeat(10_001)), ["size"]);
});
