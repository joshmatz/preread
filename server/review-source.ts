import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { comparison, git, MAX_PATCH } from "./git.ts";
import type { Mode } from "../src/types.ts";

const browsable = (name: string) => name.length > 0 &&
  name.split("/").every(part => part && ![".", "..", ".git", "node_modules"].includes(part));
export const sourceHash = (text: string) => createHash("sha256").update(text).digest("hex");

export async function reviewSource({ path, base, mode, side, version }: {
  path: string; base: string; mode: Mode; side: string; version: string;
}) {
  if (side !== "old" && side !== "new") throw new Error("Unknown comparison side.");
  const source = await comparison(path, base, mode);
  if (source.version !== version) throw new Error("The comparison changed. Refresh the review and try again.");
  const revision = side === "old" ? source.mergeBase : mode === "branch" ? source.head : "";
  const staged = !revision && mode === "staged";
  const args = revision ? ["ls-tree", "-rz", "--name-only", revision]
    : ["ls-files", "-z", "--cached", ...(staged ? [] : ["--others", "--exclude-standard"])];
  const files = new Set((await git(source.path, args)).split("\0").filter(browsable));
  const localFile = async (file: string) => {
    if (!files.has(file)) throw new Error("File is outside the comparison.");
    const absolute = resolve(source.path, file);
    if (await realpath(absolute) !== absolute) throw new Error("Linked files cannot be opened here.");
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_PATCH) throw new Error("This file is too large or has no text preview.");
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  };
  const read = async (file: string) => {
    if (!files.has(file)) throw new Error("File is outside the comparison.");
    const object = revision ? revision + ":" + file : staged ? ":0:" + file : "";
    if (object && Number(await git(source.path, ["cat-file", "-s", object])) > MAX_PATCH) throw new Error("This file is too large to preview.");
    const text = object ? await git(source.path, ["cat-file", "blob", object]) : await localFile(file);
    if (text.includes("\0")) throw new Error("Binary files have no text preview.");
    return text;
  };
  const editorTarget = async (file: string, text: string) =>
    (await localFile(file).catch(() => null)) === text ? sourceHash(text) : null;
  return { files, changes: source.files.filter(file => browsable(file.path)), read, localFile, editorTarget, root: source.path };
}
