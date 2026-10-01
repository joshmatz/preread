import type { ChangedFile, Comparison, Diff, Mode } from "./types.ts";

export interface LineRange {
  side: "old" | "new";
  start: number;
  end: number;
}
export interface GroupTarget {
  path: string;
  ranges?: LineRange[];
}
export interface ChangeGroup {
  id: string;
  title: string;
  description: string;
  targets: GroupTarget[];
}
export interface Review {
  id: string;
  title: string;
  description: string;
  path: string;
  base: string;
  mode: Mode;
  groups: ChangeGroup[];
  pullRequest?: string;
}
export interface Collection {
  id: string;
  title: string;
  description: string;
  reviews: Review[];
}
export interface ReviewReceipt {
  fingerprint: string;
  reviewedAt: string;
}
export interface FilePreview {
  file: ChangedFile;
  diff: Diff;
  partial: boolean;
  contextHash?: string;
  viewHash?: string;
  error?: string;
}
export interface MarkedFile {
  path: string;
  viewHash: string;
  patchHash: string;
}
export interface ReviewSection {
  id: string;
  title: string;
  description: string;
  files: FilePreview[];
  fingerprint: string;
  reviewed: boolean;
  reviewedAt?: string;
  changedSinceReview: boolean;
  canReview: boolean;
  warnings: string[];
}
export interface ReviewSnapshot {
  comparison: Comparison;
  sections: ReviewSection[];
}

export interface ReviewProgress {
  status: "unreviewed" | "partial" | "reviewed" | "changed" | "empty" | "attention" | "unavailable";
  reviewedGroups: number;
  totalGroups: number;
  changedGroups: number;
  attentionGroups: number;
  error?: string;
}

export interface ProgressSource {
  empty: boolean;
  sections: Array<{
    reviewed: boolean;
    canReview: boolean;
    changedSinceReview: boolean;
    files: MarkedFile[];
  }>;
}
export type ProgressDetails = ReviewProgress & { source?: ProgressSource };
