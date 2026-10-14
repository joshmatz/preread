import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();
let version = 0;
const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};
const storageChanged = (event: StorageEvent) => {
  if (event.storageArea !== localStorage) return;
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
    const stored = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof stored === "boolean" ? stored : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: boolean) => {
  // Keep controls usable in this session when browser storage is unavailable.
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export const fileViewed = (scope: string, path: string, hash: string, fallback = false) =>
  read(`file-viewed:${scope}|${path}|${hash}`, fallback);
export const useFileStateVersion = () => useSyncExternalStore(subscribe, () => version);
export function setFilesViewed(
  scope: string,
  files: Array<{ path: string; hash: string }>,
  value: boolean,
) {
  for (const file of files) {
    const identity = `${scope}|${file.path}|${file.hash}`;
    write(`file-viewed:${identity}`, value);
    write(`file-collapsed:${identity}`, value);
  }
  emit();
}
export function useFileState(scope: string, path: string, hash: string, fallback = false) {
  const identity = `${scope}|${path}|${hash}`;
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
