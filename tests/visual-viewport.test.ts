import { test } from "node:test";
import assert from "node:assert/strict";
import { fitVisual, zoomVisual, MAX_ZOOM } from "../src/visual-viewport.ts";
test("large diagrams fit without clipping and small images retain their native size", () => {
  const large = fitVisual({ width: 6000, height: 3000 }, { width: 1000, height: 500 });
  assert.ok(large.scale * 6000 <= 952); assert.ok(large.scale * 3000 <= 452);
  assert.equal(fitVisual({ width: 200, height: 100 }, { width: 1000, height: 500 }).scale, 1);
});
test("zoom preserves the diagram location under the pointer, including at the zoom limit", () => {
  const old = { scale: 1.2, x: 40, y: -25 }; const pointer = { x: 100, y: 60 };
  for (const scale of [3, 0.2, 100]) {
    const next = zoomVisual(old, scale, pointer);
    assert.ok(Math.abs((pointer.x - next.x) / next.scale - (pointer.x - old.x) / old.scale) < 1e-9);
    assert.ok(Math.abs((pointer.y - next.y) / next.scale - (pointer.y - old.y) / old.scale) < 1e-9);
    assert.ok(next.scale <= MAX_ZOOM);
  }
});
