export type Mode = "branch" | "all" | "working" | "staged";
export interface Worktree {
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  locked: boolean;
}
export interface Repository {
  path: string;
  name: string;
  commonDir: string;
  branch: string;
  head: string;
  dirty: boolean;
  worktrees: Worktree[];
  refs: string[];
  defaultBase: string;
}
export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  untracked?: boolean;
}
export interface Commit {
  sha: string;
  subject: string;
  author: string;
  date: string;
}
export interface Comparison {
  base: string;
  baseSha: string;
  mergeBase: string;
  head: string;
  files: ChangedFile[];
  commits: Commit[];
  commitCount: number;
  version: string;
  warnings: string[];
}
export type ImageSide = "old" | "new";
export interface Diff {
  patch: string;
  binary: boolean;
  tooLarge: boolean;
  empty: boolean;
  hash: string;
  image?: Partial<Record<ImageSide, { size: number }>>;
}
export interface StackNode {
  branch: string;
  path: string;
  head: string;
  relation: "ancestor" | "current" | "descendant";
  distance: number;
}
