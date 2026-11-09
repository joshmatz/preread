import { test } from "node:test";
import assert from "node:assert/strict";
import { frameAt, gifFrames } from "../src/gif-frames.ts";

// Tiny GIFs use a clear code before each palette index, keeping LZW codes at 3 bits.
function fixture(frames: { pixels: number[]; left?: number; disposal?: number; delay?: number; transparent?: boolean }[]) {
  const bytes = [...Buffer.from("GIF89a"), 2, 0, 1, 0, 0x81, 3, 0,
    255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];
  for (const frame of frames) {
    const codes = [...frame.pixels.flatMap((pixel) => [4, pixel]), 5];
    const packed = new Uint8Array(Math.ceil(codes.length * 3 / 8));
    codes.forEach((code, index) => {
      const offset = index * 3;
      packed[offset >>> 3] |= code << (offset % 8);
      if (offset % 8 > 5) packed[(offset >>> 3) + 1] |= code >>> (8 - offset % 8);
    });
    bytes.push(0x21, 0xf9, 4, (frame.disposal ?? 1) << 2 | (frame.transparent ? 1 : 0),
      frame.delay ?? 10, 0, 3, 0, 0x2c, frame.left ?? 0, 0, 0, 0, frame.pixels.length, 0, 1, 0, 0,
      2, packed.length, ...packed, 0);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes).buffer;
}
const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];
const white = [255, 255, 255, 255], clear = [0, 0, 0, 0];

test("timeline uses each frame’s delay and holds the final frame at the end", () => {
  const gif = gifFrames(fixture([{ pixels: [0, 0], delay: 1 }, { pixels: [1], delay: 25 }, { pixels: [2], delay: 0 }]));
  assert.deepEqual(gif.info.ends, [100, 350, 450]);
  assert.equal(gif.info.duration, 450);
  for (const [time, index] of [[0, 0], [99, 0], [100, 1], [349, 1], [350, 2], [450, 2]])
    assert.equal(frameAt(gif.info.ends, time), index);
});
test("forward and backward seeks composite partial transparent frames without ghosting", () => {
  const gif = gifFrames(fixture([{ pixels: [0, 0] }, { pixels: [1, 3], transparent: true }, { pixels: [2], left: 1 }]));
  assert.deepEqual([...gif.render(2)], [...green, ...blue]);
  assert.deepEqual([...gif.render(0)], [...red, ...red]);
  assert.deepEqual([...gif.render(1)], [...green, ...red]);
  assert.deepEqual([...gif.render(1)], [...green, ...red]);
});
test("restore-background disposal clears only the previous frame’s rectangle", () => {
  for (const transparent of [false, true]) {
    const gif = gifFrames(fixture([{ pixels: [0, 0] }, { pixels: [1], disposal: 2, transparent }, { pixels: [2], left: 1 }]));
    assert.deepEqual([...gif.render(2)], [...(transparent ? clear : white), ...blue]);
    assert.deepEqual([...gif.render(1)], [...green, ...red]);
  }
});
test("restore-previous disposal restores the image before the temporary frame", () => {
  const gif = gifFrames(fixture([{ pixels: [0, 0] }, { pixels: [1], disposal: 3 }, { pixels: [2], left: 1 }]));
  assert.deepEqual([...gif.render(2)], [...red, ...blue]);
  assert.deepEqual([...gif.render(1)], [...green, ...red]);
  assert.deepEqual([...gif.render(2)], [...red, ...blue]);
});
test("static GIFs render and invalid or oversized GIFs fail before bitmap allocation", () => {
  const data = fixture([{ pixels: [0, 1] }]);
  assert.deepEqual([...gifFrames(data).render(0)], [...red, ...green]);
  assert.throws(() => gifFrames(new ArrayBuffer(0)), /not a GIF/);
  assert.throws(() => gifFrames(fixture([])), /empty/);
  new Uint8Array(data).set([255, 255, 255, 255], 6);
  assert.throws(() => gifFrames(data), /too large/);
  assert.throws(() => gifFrames(fixture([{ pixels: [0, 1], left: 1 }])), /invalid frame/);
});
