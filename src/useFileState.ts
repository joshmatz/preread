import { useSyncExternalStore } from "react";
import type { MarkedFile } from "./review-types";

const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();
let version = 0;
const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};
const storageChanged = (event: StorageEvent) => {
  if (event.storageArea !== window.localStorage) return;
  if (event.key) memory.delete(event.key);
  else memory.clear();
  emit();
};
const subscribe = (listener: () => void) => {
  if (!listeners.size) window.addEventListener("storage", storageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
};
const stored = (key: string) => {
  if (memory.has(key)) return memory.get(key);
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
};
const write = (key: string, value: boolean) => {
  // Keep controls usable in this session when browser storage is unavailable.
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
// Earlier keys put the review's base and mode between the worktree and the file.
const legacyKey =
  /^(file-(?:viewed|collapsed):[/~][^|]*)\|[^|]*\|(?:branch|all|working|staged)\|(.+\|(?:[0-9a-f]{64})?)$/s;
export const currentKey = (key: string) => {
  const match = legacyKey.exec(key);
  return match ? `${match[1]}|${match[2]}` : undefined;
};
export function migrateMarks(storage: Storage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)!);
  for (const key of keys) {
    const next = currentKey(key);
    if (!next) continue;
    try {
      const value = storage.getItem(key)!;
      // Removing first leaves room for the shorter key when storage is full.
      storage.removeItem(key);
      if (value === "true" || storage.getItem(next) === null) storage.setItem(next, value);
    } catch {}
  }
}
try {
  migrateMarks(window.localStorage);
} catch {}

type Kind = "viewed" | "collapsed";
// Leaves out the review's base and mode, so a mark survives the review moving to a new base.
const key = (kind: Kind, worktree: string, file: MarkedFile, hash = file.viewHash) =>
  `file-${kind}:${worktree}|${file.path}|${hash}`;
const mark = (kind: Kind, worktree: string, file: MarkedFile, fallback: boolean) => {
  const current = stored(key(kind, worktree, file));
  if (current !== undefined) return current;
  // Marks saved before view hashes are keyed by the patch hash, which any edit to the file
  // changes. Copying one to its view hash keeps it until the block itself changes.
  const saved = stored(key(kind, worktree, file, file.patchHash));
  if (saved === undefined) return fallback;
  write(key(kind, worktree, file), saved);
  return saved;
};
export const fileViewed = (worktree: string, file: MarkedFile, fallback = false) =>
  mark("viewed", worktree, file, fallback);
export const useFileStateVersion = () => useSyncExternalStore(subscribe, () => version);
export function setFilesViewed(worktree: string, files: MarkedFile[], value: boolean) {
  for (const file of files) {
    write(key("viewed", worktree, file), value);
    write(key("collapsed", worktree, file), value);
  }
  emit();
}
export function useFileState(worktree: string, file: MarkedFile, fallback = false) {
  const snapshot = useSyncExternalStore(subscribe, () => {
    const viewed = mark("viewed", worktree, file, fallback);
    const collapsed = mark("collapsed", worktree, file, viewed);
    return Number(viewed) + Number(collapsed) * 2;
  });
  return {
    viewed: Boolean(snapshot & 1),
    collapsed: Boolean(snapshot & 2),
    setViewed: (value: boolean) => setFilesViewed(worktree, [file], value),
    setCollapsed: (value: boolean) => {
      write(key("collapsed", worktree, file), value);
      emit();
    },
  };
}
