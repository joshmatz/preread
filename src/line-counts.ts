import { fileKind, isTestFile, type FileKind } from "./file-kinds";
import type { ChangedFile } from "./types";

export const lineAreaLabels = { runtime: "Runtime", tests: "Tests", evals: "Evals", misc: "Misc" };
export type LineArea = keyof typeof lineAreaLabels;
export interface LineCount {
  plus: number;
  minus: number;
}

const evalDirectory = /(^|\/)(evals?|evaluations?)\//i;
const evalName = /[._-]evals?\./i;
const runtimeKinds = new Set<FileKind>(["code", "styles", "database", "script"]);

export function lineArea(path: string): LineArea {
  if (evalDirectory.test(path) || evalName.test(path.split("/").at(-1)!)) return "evals";
  if (isTestFile(path)) return "tests";
  return runtimeKinds.has(fileKind(path)) ? "runtime" : "misc";
}

export function lineCounts(files: ChangedFile[]) {
  const empty = () => ({ plus: 0, minus: 0 });
  const areas: Record<LineArea, LineCount> = { runtime: empty(), tests: empty(), evals: empty(), misc: empty() };
  const total = empty();
  for (const file of files) {
    const area = areas[lineArea(file.path)];
    area.plus += file.additions;
    area.minus += file.deletions;
    total.plus += file.additions;
    total.minus += file.deletions;
  }
  return { areas, total };
}
