// Count the rows actually offered by the patch, rather than the whole source file.
// Context rows count too; a tiny change in a long file can still render immediately.
export const AUTO_RENDER_LINES = 500;
export const AUTO_RENDER_BYTES = 100 * 1024;
export function diffSize(patch: string) {
  let lines = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) inHunk = true;
    else if (line.startsWith("diff --git ")) inHunk = false;
    else if (inHunk && /^[ +\-]/.test(line)) lines++;
  }
  const bytes = new TextEncoder().encode(patch).byteLength;
  return { lines, bytes, deferred: lines >= AUTO_RENDER_LINES || bytes >= AUTO_RENDER_BYTES };
}
