import { useSyncExternalStore } from "react";

const storageKey = "file-notes";
// Earlier note keys put the review's base and mode between the checkout path and the file.
const legacyKey = /^([/~][^|]*)\|[^|]*\|(?:branch|all|working|staged)\|(.+)$/s;
export function mergeNotes(notes: Record<string, string>, legacy: Record<string, string>) {
  const merged = new Map(Object.entries(notes).map(([key, text]) => [key, [text]]));
  for (const [key, text] of Object.entries(legacy)) {
    const match = legacyKey.exec(key);
    const next = match ? `${match[1]}|${match[2]}` : key;
    const texts = merged.get(next) ?? [];
    if (!texts.some((existing) => existing.trim() === text.trim())) texts.push(text);
    merged.set(next, texts);
  }
  const result: Record<string, string> = {};
  for (const [key, texts] of merged) {
    const text = texts.filter((entry) => entry.trim()).join("\n\n");
    if (text) result[key] = text;
  }
  return result;
}
export function migrateNotes(storage: Storage) {
  const legacy = storage.getItem("notes");
  if (legacy === null) return;
  const notes = JSON.parse(storage.getItem(storageKey) ?? "{}") ?? {};
  storage.setItem(storageKey, JSON.stringify(mergeNotes(notes, JSON.parse(legacy) ?? {})));
  storage.removeItem("notes");
}
try {
  migrateNotes(window.localStorage);
} catch {}

const listeners = new Set<() => void>();
const load = (): Record<string, string> => {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
let notes: Record<string, string> | undefined;
const read = () => (notes ??= load());
const emit = () => listeners.forEach((listener) => listener());
const storageChanged = (event: StorageEvent) => {
  if (event.key !== null && event.key !== storageKey) return;
  notes = undefined;
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
// Every card and tab showing a file edits one shared note, so none writes stale text over another.
export function useNote(key: string) {
  const note = useSyncExternalStore(subscribe, () => read()[key] ?? "");
  const setNote = (text: string) => {
    const next = { ...read() };
    if (text) next[key] = text;
    else delete next[key];
    notes = next;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
    emit();
  };
  return [note, setNote] as const;
}
