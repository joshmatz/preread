import assert from "node:assert/strict";
import { test } from "node:test";
import { changeFrom } from "../src/draw-diff.ts";

type Cell = { kind: "del" | "ins"; line: number; top: number; height?: number };

// Line-number cells in document order, with just the DOM reads the helper makes.
function card(cells: Cell[], split = false) {
  const nodes = cells.map(({ kind, line, top, height = 20 }) => ({
    kind,
    classList: { contains: (name: string) => name === "d2h-" + kind },
    textContent: split ? ` ${line} ` : "",
    querySelector: (selector: string) =>
      !split && selector === (kind === "del" ? ".line-num1" : ".line-num2") ? { textContent: String(line) } : null,
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
  }));
  return {
    querySelectorAll: (selector: string) => nodes.filter((node) => selector.includes(".d2h-" + node.kind)),
  } as unknown as HTMLElement;
}

const rows: Cell[] = [
  { kind: "ins", line: 6, top: -2000 },
  { kind: "ins", line: 162, top: 340 },
  { kind: "ins", line: 189, top: 900 },
];

test("opens on the first change still below the toolbar", () => {
  assert.deepEqual(changeFrom(card(rows), false, 330), { side: "new", line: 162 });
  // A row half under the toolbar is still in view.
  assert.deepEqual(changeFrom(card(rows), false, 350), { side: "new", line: 162 });
  assert.deepEqual(changeFrom(card(rows), false, -2100), { side: "new", line: 6 });
});

test("past every change, opens on the last one above", () => {
  assert.deepEqual(changeFrom(card(rows), false, 1000), { side: "new", line: 189 });
});

test("a removed line leads its row, except since viewed", () => {
  const replaced = card([{ kind: "del", line: 18, top: 400 }, { kind: "ins", line: 20, top: 400 }], true);
  assert.deepEqual(changeFrom(replaced, true, 300), { side: "old", line: 18 });
  assert.deepEqual(changeFrom(replaced, true, 300, true), { side: "new", line: 20 });
});

test("a collapsed card has no change to open on", () => {
  assert.equal(changeFrom(card(rows.map((row) => ({ ...row, top: 0, height: 0 }))), false, 300), undefined);
});
