import assert from "node:assert/strict";
import { test } from "node:test";
import { occurrences, spans } from "../src/SourceFind.tsx";

test("finds every place a query starts, ignoring case", () => {
  assert.deepEqual(occurrences("const Found = find(found);", "found"), [6, 19]);
  assert.deepEqual(occurrences("anything", ""), []);
});

test("reads the query as plain text", () => {
  assert.deepEqual(occurrences("a.b(c) + a*b", "a.b("), [0]);
  assert.deepEqual(occurrences("a.b(c) + a*b", "a*b"), [9]);
});

test("matches follow one another without overlapping", () => {
  assert.deepEqual(occurrences("aaaa", "aa"), [0, 2]);
});

test("maps a match across the syntax spans it crosses", () => {
  // `return value;` drawn as "return", " ", "value", ";"
  const lengths = [6, 1, 5, 1];
  assert.deepEqual(spans(lengths, [4], 5), [{ start: [0, 4], end: [2, 2] }]);
  assert.deepEqual(spans(lengths, [7], 5), [{ start: [2, 0], end: [2, 5] }]);
});

test("a match ending a node leaves the next match to start in the following one", () => {
  assert.deepEqual(spans([2, 2], [0, 2], 2), [{ start: [0, 0], end: [0, 2] }, { start: [1, 0], end: [1, 2] }]);
});
