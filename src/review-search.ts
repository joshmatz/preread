export type SearchScope = "files" | "contents" | "all";
export type SearchDocument = { key: string; path: string; oldPath?: string; patch: string; unavailable?: boolean };
export type SearchLine = { text: string; lower: string; side: "old" | "new"; line: number; chunk: number };
export type SearchEntry = SearchDocument & { paths: string; lines: SearchLine[] };
export type SearchMatch = Omit<SearchLine, "lower">;
export type SearchResult = { key: string; count: number; matches: SearchMatch[] };

export function indexSearch(documents: SearchDocument[]): SearchEntry[] {
  return documents.map((document) => ({ ...document, paths: `${document.path}\n${document.oldPath ?? ""}`.toLowerCase(), lines: searchLines(document.patch) }));
}

export function searchLines(patch: string): SearchLine[] {
  return diffChunks(patch).flatMap((pagePatch, chunk) => searchPage(pagePatch, chunk));
}

function searchPage(patch: string, chunk: number): SearchLine[] {
  let old = 0;
  let next = 0;
  let active = false;
  const result: SearchLine[] = [];
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); active = true; continue; }
    if (text.startsWith("diff --git ")) { active = false; continue; }
    if (!active || !/^[ +\-]/.test(text)) continue;
    const side = text[0] === "-" ? "old" : "new";
    result.push({ text: text.slice(1), lower: text.slice(1).toLowerCase(), side, line: side === "old" ? old : next, chunk });
    if (text[0] !== "+") old++;
    if (text[0] !== "-") next++;
  }
  return result;
}

export function searchIndex(entries: SearchEntry[], query: string, scope: SearchScope): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  for (const entry of entries) {
    const named = scope !== "contents" && entry.paths.includes(needle);
    const matching = scope === "files" ? [] : entry.lines.filter((line) => line.lower.includes(needle));
    if (!named && !matching.length) continue;
    results.push({ key: entry.key, count: matching.length, matches: matching.slice(0, 3).map(({ lower: _lower, text, ...line }) => {
      const offset = Math.max(0, text.toLowerCase().indexOf(needle) - 50);
      return { ...line, text: `${offset ? "…" : ""}${text.slice(offset, offset + 180)}${text.length > offset + 180 ? "…" : ""}` };
    }) });
  }
  return results;
}
import { diffChunks } from "./diff-chunks";

