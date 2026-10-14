export const DIFF_CHUNK_ROWS = 300;
export function diffChunks(patch: string): string[] {
  const files = patch.split(/(?=^diff --git )/m).filter(Boolean);
  if (files.length > 1) {
    let active = false;
    let rows = 0;
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) active = false;
      else if (line.startsWith("@@ ")) active = true;
      else if (active && /^[ +\-]/.test(line)) rows++;
    }
    return rows <= DIFF_CHUNK_ROWS ? [patch] : files.flatMap(diffChunks);
  }
  const lines = patch.split("\n");
  const first = lines.findIndex((line) => line.startsWith("@@ "));
  if (first < 0) return [patch];
  const header = lines.slice(0, first).join("\n");
  const chunks: string[] = [];
  let blocks: string[] = [];
  let rows = 0;
  let old = 0;
  let next = 0;
  let startOld = 0;
  let startNext = 0;
  let oldCount = 0;
  let nextCount = 0;
  let body: string[] = [];
  const flushBlock = () => {
    if (!body.length) return;
    blocks.push(`@@ -${oldCount ? startOld : Math.max(0, startOld - 1)},${oldCount} +${nextCount ? startNext : Math.max(0, startNext - 1)},${nextCount} @@\n${body.join("\n")}`);
    body = []; oldCount = 0; nextCount = 0;
    startOld = old; startNext = next;
  };
  const flushChunk = () => {
    flushBlock();
    if (blocks.length) chunks.push(`${header}\n${blocks.join("\n")}\n`);
    blocks = []; rows = 0;
  };
  for (const line of lines.slice(first)) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) { flushBlock(); old = Number(hunk[1]) + (hunk[2] === "0" ? 1 : 0); next = Number(hunk[3]) + (hunk[4] === "0" ? 1 : 0); startOld = old; startNext = next; continue; }
    if (line.startsWith("\\")) { body.push(line); continue; }
    if (!/^[ +\-]/.test(line)) continue;
    if (rows === DIFF_CHUNK_ROWS) flushChunk();
    body.push(line);
    if (line[0] !== "+") { old++; oldCount++; }
    if (line[0] !== "-") { next++; nextCount++; }
    rows++;
  }
  flushChunk();
  return chunks.length > 1 ? chunks : [patch];
}
