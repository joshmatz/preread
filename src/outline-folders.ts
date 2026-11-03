export function byFolder<T extends { file: { path: string } }>(previews: T[]) {
  const folders = new Map<string, T[]>();
  for (const preview of previews) {
    const { path } = preview.file;
    const folder = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    const files = folders.get(folder);
    if (files) files.push(preview);
    else folders.set(folder, [preview]);
  }
  return [...folders].map(([folder, files]) => ({ folder, files }));
}

// Drops whole leading folders, where a CSS ellipsis would cut through a name.
export function fitPath(path: string, width: number, measure: (text: string) => number) {
  const parts = path.split("/");
  let text = path;
  for (let start = 1; start < parts.length && measure(text) > width; start++)
    text = `…/${parts.slice(start).join("/")}`;
  return text;
}
