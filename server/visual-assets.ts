import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile, rename } from "node:fs/promises";
import { extname, join, dirname, resolve } from "node:path";
import type { ReviewVisual } from "../src/review-types.ts";

export const MAX_MERMAID_BYTES = 64 * 1024;
export const MAX_VISUAL_BYTES = 10 * 1024 * 1024;
const types: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".mmd": "text/plain", ".mermaid": "text/plain" };
export function visualType(name: string) {
  const type = types[extname(name).toLowerCase()];
  if (!type) throw new Error("Visuals must be PNG, JPEG, WebP, GIF, SVG or Mermaid files.");
  return type;
}
function inspect(content: Buffer, name: string) {
  const type = visualType(name);
  if (!content.length || content.length > MAX_VISUAL_BYTES)
    throw new Error("Visuals must be nonempty and no larger than 10 MB.");
  if (type === "text/plain") {
    if (content.length > MAX_MERMAID_BYTES) throw new Error("Mermaid diagrams must be no larger than 64 KB.");
    let source: string;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(content); }
    catch { throw new Error("Mermaid diagrams must contain UTF-8 text."); }
    if (!source.trim() || source.includes("\0")) throw new Error("Mermaid diagrams must contain nonempty text.");
    return type;
  }
  const start = content.subarray(0, 16);
  const valid = type === "image/png" ? start.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === "image/jpeg" ? start[0] === 255 && start[1] === 216 && start[2] === 255
    : type === "image/gif" ? /^GIF8[79]a/.test(start.toString("ascii"))
    : type === "image/webp" ? start.toString("ascii", 0, 4) === "RIFF" && start.toString("ascii", 8, 12) === "WEBP"
    : /^<svg[\s>]/i.test(content.toString("utf8").trimStart().replace(/^<\?xml[^>]*>\s*/i, ""));
  if (!valid) throw new Error("The visual’s content does not match its image format.");
  return type;
}
export async function storeVisual(content: Buffer, name: string, data: string) {
  inspect(content, name);
  const directory = resolve(data, "visuals");
  const extension = extname(name).toLowerCase().replace(".jpeg", ".jpg").replace(".mermaid", ".mmd");
  const path = join(directory, createHash("sha256").update(content).digest("hex") + extension);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
  return path;
}
export async function importVisuals(visuals: ReviewVisual[] | undefined, data: string) {
  if (!visuals) return undefined;
  return Promise.all(visuals.map(async (visual) => {
    const size = (await stat(visual.path)).size;
    if (size > MAX_VISUAL_BYTES) throw new Error("Visuals must be no larger than 10 MB.");
    const content = await readFile(visual.path);
    const path = await storeVisual(content, visual.path, data);
    return { ...visual, path };
  }));
}
export async function visualAsset(path: string, data: string) {
  const directory = resolve(data, "visuals");
  // Only stored attachments can be served; query parameters never select a disk path.
  if (dirname(path) !== directory || !/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg|mmd)$/.test(path.slice(directory.length + 1)))
    throw new Error("This visual is not a stored attachment. Reimport the collection.");
  const [actual, parent] = await Promise.all([realpath(path), realpath(directory)]);
  if (dirname(actual) !== parent) throw new Error("This visual resolves outside attachment storage.");
  if ((await stat(actual)).size > MAX_VISUAL_BYTES) throw new Error("This visual is too large.");
  const content = await readFile(actual);
  const type = inspect(content, path);
  const expected = path.slice(directory.length + 1, directory.length + 65);
  if (createHash("sha256").update(content).digest("hex") !== expected)
    throw new Error("This saved visual changed unexpectedly. Reimport the collection.");
  return { content, type };
}
