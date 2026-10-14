import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "./collections.ts";
import type { MarkedFile, ReviewSection } from "../src/review-types.ts";

export type FileView = Pick<MarkedFile, "path" | "viewHash"> & { viewed: boolean };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (file: Pick<MarkedFile, "path" | "viewHash">) => hash([file.path, file.viewHash]);
const location = (worktree: string) => join(dataDirectory(), "file-views", `${hash(worktree)}.json`);
export async function readFileViews(worktree: string): Promise<Record<string, boolean>> {
  try {
    return JSON.parse(await readFile(location(worktree), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
let writes: Promise<unknown> = Promise.resolve();
export function saveFileViews(worktree: string, files: FileView[]) {
  const operation = writes.then(async () => {
    const marks = await readFileViews(worktree);
    let changed = false;
    for (const file of files) {
      const id = key(file);
      if (marks[id] === file.viewed) continue;
      marks[id] = file.viewed;
      changed = true;
    }
    if (changed) {
      await mkdir(join(dataDirectory(), "file-views"), { recursive: true, mode: 0o700 });
      const path = location(worktree);
      const temp = `${path}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(marks), { mode: 0o600 });
      await rename(temp, path);
    }
  });
  writes = operation.catch(() => {});
  return operation;
}
export async function withSharedFileViews(worktree: string, sections: ReviewSection[]) {
  const marks = await readFileViews(worktree);
  return sections.map((section) => {
    const files = section.files.map((preview) => {
      const viewHash = preview.viewHash ?? preview.diff.hash;
      const saved = marks[key({ path: preview.file.path, viewHash })];
      const viewed = saved ?? (preview.lastViewed
        ? preview.lastViewed.viewHash === viewHash
        : section.reviewed);
      return { ...preview, viewed };
    });
    return { ...section, files };
  });
}
