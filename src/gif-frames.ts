import { decompressFrame, parseGIF } from "gifuct-js";

export type GifInfo = { width: number; height: number; ends: number[]; duration: number };
export type GifRequest = { kind: "load"; data: ArrayBuffer } | { kind: "frame"; index: number };
export type GifReply = { kind: "ready"; info: GifInfo }
  | { kind: "frame"; index: number; pixels: Uint8ClampedArray<ArrayBuffer> }
  | { kind: "error"; message: string };

export function frameAt(ends: number[], time: number): number {
  let low = 0, high = ends.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (time < ends[middle]) high = middle;
    else low = middle + 1;
  }
  return low;
}

// Keep compressed frames and one composite, rather than a full bitmap per frame.
export function gifFrames(data: ArrayBuffer) {
  if (!/^GIF8[79]a/.test(new TextDecoder().decode(data.slice(0, 6)))) throw new Error("This attachment is not a GIF.");
  const gif = parseGIF(data);
  const frames = gif.frames.filter((frame) => "image" in frame);
  const { width, height } = gif.lsd;
  if (!width || !height || width * height > 16_000_000 || !frames.length)
    throw new Error("This GIF is empty or too large to scrub. Use a smaller recording.");
  for (const frame of frames) {
    const dims = frame.image.descriptor;
    if (!dims.width || !dims.height || dims.left + dims.width > width || dims.top + dims.height > height)
      throw new Error("This GIF contains an invalid frame.");
  }
  let duration = 0;
  const ends = frames.map((frame) => {
    // Match browser timing for missing and very short delays.
    const delay = (frame.gce?.delay ?? 0) * 10;
    duration += delay < 20 ? 100 : delay;
    return duration;
  });
  const info: GifInfo = { width, height, ends, duration };
  const pixels = new Uint8ClampedArray(width * height * 4);
  let previous = -1;
  let restore: Uint8ClampedArray | undefined;
  const background = gif.gct?.[gif.lsd.backgroundColorIndex];
  const clear = (left: number, top: number, w: number, h: number, transparent: boolean) => {
    const color = transparent || !background ? [0, 0, 0, 0] : [...background, 255];
    for (let y = top; y < top + h; y += 1) for (let x = left; x < left + w; x += 1) {
      const offset = (y * width + x) * 4;
      pixels.set(color, offset);
    }
  };
  return { info, render(index: number) {
    const target = Math.max(0, Math.min(frames.length - 1, Math.floor(index)));
    if (target < previous) { previous = -1; restore = undefined; }
    if (previous === -1) clear(0, 0, width, height, !!frames[0].gce?.extras.transparentColorGiven);
    for (let next = previous + 1; next <= target; next += 1) {
      const before = frames[next - 1];
      if (before?.gce?.extras.disposal === 2) {
        const dims = before.image.descriptor;
        clear(dims.left, dims.top, dims.width, dims.height, !!before.gce.extras.transparentColorGiven);
      } else if (before?.gce?.extras.disposal === 3 && restore) pixels.set(restore);
      const frame = frames[next];
      restore = frame.gce?.extras.disposal === 3 ? pixels.slice() : undefined;
      const { patch, dims } = decompressFrame(frame, gif.gct, true);
      for (let y = 0; y < dims.height; y += 1) for (let x = 0; x < dims.width; x += 1) {
        const source = (y * dims.width + x) * 4;
        if (patch[source + 3]) {
          const offset = ((y + dims.top) * width + x + dims.left) * 4;
          pixels[offset] = patch[source]; pixels[offset + 1] = patch[source + 1];
          pixels[offset + 2] = patch[source + 2]; pixels[offset + 3] = 255;
        }
      }
    }
    previous = target;
    return pixels.slice();
  } };
}
