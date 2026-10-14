type ChangedLine = { text: string; unchanged: string };
const letters = (text: string) => (text.match(/[\p{L}\p{N}_$]/gu) ?? []).length;

// Punctuation and indentation alone don't make two pieces of code related.
// Most meaningful text must survive on both sides before word highlights help.
export function relatedChanges(before: ChangedLine[], after: ChangedLine[]) {
  const size = (lines: ChangedLine[]) => lines.reduce((sum, line) => sum + letters(line.text), 0);
  const shared = Math.min(...[before, after].map((lines) =>
    lines.reduce((sum, line) => sum + letters(line.unchanged), 0)));
  return shared > 0 && shared >= size(before) / 2 && shared >= size(after) / 2;
}

function lineChange(line: HTMLElement): ChangedLine {
  const paired = line.closest("td")!.classList.contains("d2h-change");
  const unchanged = paired ? [...line.childNodes]
    .filter((node) => !(node instanceof Element && /^(INS|DEL)$/.test(node.tagName)))
    .map((node) => node.textContent ?? "").join("") : "";
  return { text: line.textContent ?? "", unchanged };
}

function clearHighlights(lines: HTMLElement[]) {
  for (const line of lines)
    for (const change of line.querySelectorAll("ins, del"))
      change.replaceWith(...change.childNodes);
}

function refineBlock(before: HTMLElement[], after: HTMLElement[]) {
  if (![...before, ...after].some((line) => line.querySelector("ins, del"))) return;
  if (!relatedChanges(before.map(lineChange), after.map(lineChange))) {
    clearHighlights([...before, ...after]);
    return;
  }
  const paired = (lines: HTMLElement[]) => lines.filter((line) =>
    line.closest("td")!.classList.contains("d2h-change"));
  const left = paired(before);
  const right = paired(after);
  left.forEach((line, index) => {
    const next = right[index];
    if (next && !relatedChanges([lineChange(line)], [lineChange(next)]))
      clearHighlights([line, next]);
  });
}

// Run before syntax highlighting adds spans and before unified rows are reordered.
export function refineWordHighlights(root: HTMLElement) {
  for (const file of root.querySelectorAll(".d2h-file-wrapper")) {
    const sides = [...file.querySelectorAll(".d2h-file-side-diff")];
    const left = [...(sides[0] ?? file).querySelectorAll("tbody > tr")];
    const right = sides.length ? [...sides[1].querySelectorAll("tbody > tr")] : left;
    let before: HTMLElement[] = [];
    let after: HTMLElement[] = [];
    const flush = () => { refineBlock(before, after); before = []; after = []; };
    left.forEach((row, index) => {
      const old = row.querySelector<HTMLElement>("td.d2h-del .d2h-code-line-ctn");
      const next = right[index]?.querySelector<HTMLElement>("td.d2h-ins .d2h-code-line-ctn");
      if (!old && !next) flush();
      if (old) before.push(old);
      if (next) after.push(next);
    });
    flush();
  }
}
