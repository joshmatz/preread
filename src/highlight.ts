import { hljs } from "diff2html/lib/ui/js/highlight.js-slim.js";
import { getLanguage, mergeStreams, nodeStream } from "diff2html/lib/ui/js/highlight.js-helpers.js";

type Run = { line: HTMLElement; shown: boolean }[];
const blockComments = new Map<string, boolean>();
const commentLine = /^\s*\*(?:\s|\/|$)/;

function splitLines(html: string) {
  const open: string[] = [];
  return html.split("\n").map((line) => {
    const reopened = open.join("") + line;
    for (const [tag] of line.matchAll(/<span[^>]*>|<\/span>/g)) {
      if (tag === "</span>") open.pop();
      else open.push(tag);
    }
    return reopened + "</span>".repeat(open.length);
  });
}

const highlight = (lines: string[], language: string) =>
  splitLines(hljs.highlight(lines.join("\n"), { language, ignoreIllegals: true }).value);

// A hunk can start inside a /** */ block, where its prose would otherwise parse as code.
function opensInComment(lines: string[], language: string) {
  if (!blockComments.has(language))
    blockComments.set(
      language,
      highlight(["/**", " */"], language)[1].startsWith('<span class="hljs-comment">'),
    );
  const first = lines.find((line) => line.trim());
  if (!blockComments.get(language) || !first || !commentLine.test(first)) return false;
  const close = lines.findIndex((line) => line.includes("*/"));
  return lines
    .slice(0, close < 0 ? undefined : close + 1)
    .every((line) => !line.trim() || commentLine.test(line));
}

export function highlightLines(lines: string[], language: string) {
  return opensInComment(lines, language)
    ? highlight(["/**", ...lines], language).slice(1)
    : highlight(lines, language);
}

function paint(line: HTMLElement, html: string) {
  const original = nodeStream(line);
  if (original.length) {
    const highlighted = document.createElement("div");
    highlighted.innerHTML = html;
    html = mergeStreams(original, nodeStream(highlighted), line.textContent ?? "");
  }
  line.classList.add("hljs");
  line.innerHTML = html;
}

// Replaces Diff2HtmlUI.highlightCode, which highlights each line alone and so
// loses comments and strings that span lines.
export function highlightDiff(root: HTMLElement) {
  for (const file of root.querySelectorAll<HTMLElement>(".d2h-file-wrapper")) {
    const name = getLanguage(file.dataset.lang ?? "");
    const language = hljs.getLanguage(name) ? name : "plaintext";
    const sides = [...file.querySelectorAll<HTMLElement>(".d2h-file-side-diff")];
    const tables = sides.length
      ? sides.map((side, index) => [side, index ? "new" : "old"] as const)
      : [[file, "both"] as const];
    for (const [table, side] of tables) {
      let old: Run = [];
      let next: Run = [];
      const flush = () => {
        for (const run of [old, next]) {
          const html = highlightLines(run.map(({ line }) => line.textContent ?? ""), language);
          run.forEach(({ line, shown }, index) => shown && paint(line, html[index]));
        }
        old = [];
        next = [];
      };
      for (const row of table.querySelectorAll("tr")) {
        if (row.querySelector(".d2h-info")) {
          flush();
          continue;
        }
        const line = row.querySelector<HTMLElement>(".d2h-code-line-ctn");
        const cell = line?.closest("td");
        if (!line || !cell || cell.classList.contains("d2h-emptyplaceholder")) continue;
        const deleted = cell.classList.contains("d2h-del");
        const inserted = cell.classList.contains("d2h-ins");
        // Unchanged lines feed both sides' state but show the new side's colors.
        if (side !== "new" && !inserted) old.push({ line, shown: side === "old" || deleted });
        if (side !== "old" && !deleted) next.push({ line, shown: true });
      }
      flush();
    }
  }
}
