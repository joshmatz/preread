import { useSyncExternalStore } from "react";

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
const read = (key: string, fallback: boolean) => {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return typeof stored === "boolean" ? stored : fallback;
  } catch {
    return fallback;
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

// Leaves out the review's base and mode, so a mark survives the review moving to a new base.
export const fileViewed = (worktree: string, path: string, hash: string, fallback = false) =>
  read(`file-viewed:${worktree}|${path}|${hash}`, fallback);
export const useFileStateVersion = () => useSyncExternalStore(subscribe, () => version);
export function setFilesViewed(
  worktree: string,
  files: Array<{ path: string; hash: string }>,
  value: boolean,
) {
  for (const file of files) {
    const identity = `${worktree}|${file.path}|${file.hash}`;
    write(`file-viewed:${identity}`, value);
    write(`file-collapsed:${identity}`, value);
  }
  emit();
}
export function useFileState(worktree: string, path: string, hash: string, fallback = false) {
  const identity = `${worktree}|${path}|${hash}`;
  const viewKey = `file-viewed:${identity}`;
  const collapseKey = `file-collapsed:${identity}`;
  const snapshot = useSyncExternalStore(subscribe, () => {
    const viewed = read(viewKey, fallback);
    const collapsed = read(collapseKey, viewed);
    return Number(viewed) + Number(collapsed) * 2;
  });
  return {
    viewed: Boolean(snapshot & 1),
    collapsed: Boolean(snapshot & 2),
    setViewed: (value: boolean) => {
      write(viewKey, value);
      write(collapseKey, value);
      emit();
    },
    setCollapsed: (value: boolean) => {
      write(collapseKey, value);
      emit();
    },
  };
}
