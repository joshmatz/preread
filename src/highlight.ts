import { hljs } from "diff2html/lib/ui/js/highlight.js-slim.js";
import { getLanguage, mergeStreams, nodeStream } from "diff2html/lib/ui/js/highlight.js-helpers.js";
import { parse } from "diff2html";
import { callTree } from "./call-tree-language";
import { showCarriageReturns } from "./whitespace-diff";

hljs.registerLanguage("call-tree", callTree);
export { hljs };

// The language the diff highlights a file in.
const diffLanguage = (extension: string) => {
  const language = getLanguage(extension);
  return hljs.getLanguage(language) ? language : "plaintext";
};
export const pathLanguage = (path: string) => diffLanguage(/\.([^./]+)$/.exec(path)?.[1] ?? "");

export type Run = { line: HTMLElement; shown: boolean }[];
type NumberedRun = (Run[number] & { number: number; nextNumber?: number })[];
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
  splitLines(hljs.highlight(lines.join("\n"), {
    language: lines.some((line) => line.length > 10000) ? "plaintext" : language,
    ignoreIllegals: true,
  }).value);

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

export type DiffSyntax = Record<"old" | "new", { text: string; html: string }[]>;

// Only tokenize when every displayed line has an unbroken prefix from line 1.
// A whole-context patch supplies that prefix even for blocks hidden in the UI.
export function diffSyntax(patch: string): DiffSyntax | undefined {
  const syntax: DiffSyntax = { old: [], new: [] };
  for (const file of parse(showCarriageReturns(patch))) {
    if (file.isCombined) return;
    const before: string[] = [];
    const after: string[] = [];
    for (const block of file.blocks) {
      for (const { oldNumber, newNumber, content } of block.lines) {
        const text = content.slice(1);
        if (oldNumber !== undefined) {
          if (oldNumber !== before.length + 1) return;
          before.push(text);
        }
        if (newNumber !== undefined) {
          if (newNumber !== after.length + 1) return;
          after.push(text);
        }
      }
    }
    if ((before.length && syntax.old.length) || (after.length && syntax.new.length)) return;
    const language = diffLanguage(file.language ?? "");
    for (const [side, lines] of [["old", before], ["new", after]] as const) {
      if (!lines.length) continue;
      const html = highlight(lines, language);
      syntax[side] = lines.map((text, index) => ({ text, html: html[index] }));
    }
  }
  return syntax.old.length || syntax.new.length ? syntax : undefined;
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
// loses comments and strings that span lines. `decorate` reads the same runs.
export function highlightDiff(root: HTMLElement, decorate?: (run: Run, extension: string) => void, syntax?: DiffSyntax) {
  for (const file of root.querySelectorAll<HTMLElement>(".d2h-file-wrapper")) {
    const language = diffLanguage(file.dataset.lang ?? "");
    const sides = [...file.querySelectorAll<HTMLElement>(".d2h-file-side-diff")];
    const tables = sides.length
      ? sides.map((side, index) => [side, index ? "new" : "old"] as const)
      : [[file, "both"] as const];
    for (const [table, side] of tables) {
      let old: NumberedRun = [];
      let next: NumberedRun = [];
      const flush = () => {
        for (const [side, run] of [["old", old], ["new", next]] as const) {
          let fallback: string[] | undefined;
          run.forEach(({ line, shown, number, nextNumber }, index) => {
            if (!shown) return;
            const exact = syntax?.[side][number - 1];
            const text = line.textContent ?? "";
            if (exact?.text === text) return paint(line, exact.html);
            // With whitespace hidden, the old context cell can display the new text.
            const shared = nextNumber === undefined ? undefined : syntax?.new[nextNumber - 1];
            if (shared?.text === text) return paint(line, shared.html);
            fallback ??= highlightLines(run.map(({ line }) => line.textContent ?? ""), language);
            paint(line, fallback[index]);
          });
          if (decorate && run.length) decorate(run, file.dataset.lang ?? "");
        }
        old = [];
        next = [];
      };
      const diffRows = ".d2h-diff-tbody > tr:not(.context-row, .line-comment-row, .line-comment-spacer)";
      const rows = [...table.querySelectorAll(diffRows)];
      const newRows = side === "old" && syntax ? [...sides[1].querySelectorAll(diffRows)] : [];
      for (const [index, row] of rows.entries()) {
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
        if (side !== "new" && !inserted) old.push({
          line, shown: side === "old" || deleted,
          number: Number(row.querySelector(side === "old" ? ".d2h-code-side-linenumber" : ".line-num1")?.textContent),
          nextNumber: deleted ? undefined : Number(newRows[index]?.querySelector(".d2h-code-side-linenumber")?.textContent),
        });
        if (side !== "old" && !deleted) next.push({
          line, shown: true,
          number: Number(row.querySelector(side === "new" ? ".d2h-code-side-linenumber" : ".line-num2")?.textContent),
        });
      }
      flush();
    }
  }
}
