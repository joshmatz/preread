import { indexSearch, searchIndex, type SearchDocument, type SearchEntry, type SearchScope } from "./review-search";
let entries: SearchEntry[] = [];
onmessage = (event: MessageEvent<{ documents?: SearchDocument[]; query?: string; scope: SearchScope; id: number }>) => {
  const { documents, query, scope, id } = event.data;
  if (documents) entries = indexSearch(documents);
  if (query !== undefined) postMessage({ id, results: searchIndex(entries, query, scope) });
};
