import type { CodeDraft } from "./CodeComments";

// Per tab, so a reload (a server restart or `pnpm refresh --page`) or a trip to another view keeps unsaved comments.
const storageKey = "preread-code-drafts";
const read = (): Record<string, CodeDraft> => {
  try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "{}") ?? {}; } catch { return {}; }
};
const worthKeeping = (draft: CodeDraft) => !!draft.text.trim() && draft.text !== draft.comment?.body;
export function loadDrafts(card: string): Record<string, CodeDraft> {
  const prefix = `${card}\n`;
  return Object.fromEntries(Object.entries(read()).filter(([key]) => key.startsWith(prefix)).map(([key, draft]) => [key.slice(prefix.length), draft]));
}
export function saveDrafts(card: string, drafts: Record<string, CodeDraft>) {
  const prefix = `${card}\n`;
  const next = Object.fromEntries([
    ...Object.entries(read()).filter(([key]) => !key.startsWith(prefix)),
    ...Object.entries(drafts).filter(([, draft]) => worthKeeping(draft)).map(([key, draft]) => [prefix + key, draft]),
  ]);
  try {
    if (Object.keys(next).length) sessionStorage.setItem(storageKey, JSON.stringify(next));
    else sessionStorage.removeItem(storageKey);
  } catch {}
}
