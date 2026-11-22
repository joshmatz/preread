export type CallTreePart =
  | { kind: "mark"; label: string; changed: boolean; separator: string; detail: string }
  | { kind: "link"; label: string; name?: string; direction: "above" | "below" | "any"; separator: string; detail: string; target?: CallTreeStep }
  | { kind: "text"; text: string };
export type CallTreePiece =
  | { kind: "code"; text: string }
  | { kind: "note"; items: { before: string; part: CallTreePart }[]; after: string };
export type CallTreeStep = {
  id: number; depth: number; start: number; end: number;
  /** The source text between the step above and this one: line breaks, blank lines and indentation. */
  lead: string;
  pieces: CallTreePiece[]; parent?: CallTreeStep; children: CallTreeStep[];
};
export type CallTree = { steps: CallTreeStep[]; roots: CallTreeStep[]; tail: string };

const keyword = /^(?:(?:existing|changed|above|below|the service)\b|see\s+\S|PR \d+\b)/;
const name = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
// What a step does comes after its branch or assignment: `if x: findTodo(…)`, `[todo] = findTodoRows(…)`.
const prefixes = [/^(?:if|else if|unless|while|when|for each)\b[^:]*:\s+/, /^(?:else|try|finally|catch|then|in parallel):\s*/,
  /^(?:await|return|throw)\s+/, /^\[[^\]]*\]\s*=\s*/, /^[\w$.]+\s*=\s*/];
// A step can also test a call: `if !isOpen(todo):`. It names that call less than a step that makes it.
const condition = /^(?:if|else if|unless|while|when)\s+!?/;

export function parseCallTree(code: string): CallTree {
  const steps: CallTreeStep[] = [];
  const roots: CallTreeStep[] = [];
  const open: { step: CallTreeStep; width: number }[] = [];
  let offset = 0;
  let last = 0;
  for (const line of code.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const content = line.trim();
    if (!content) continue;
    const indent = line.length - line.trimStart().length;
    const width = [...line.slice(0, indent)].reduce((total, character) => total + (character === "\t" ? 2 : 1), 0);
    while (open.length && open[open.length - 1].width >= width) open.pop();
    const parent = open.at(-1)?.step;
    const start = lineStart + indent;
    const step: CallTreeStep = { id: steps.length, depth: open.length, start, end: start + content.length,
      lead: code.slice(last, start), pieces: pieces(content), parent, children: [] };
    (parent ? parent.children : roots).push(step);
    open.push({ step, width });
    steps.push(step);
    last = step.end;
  }
  for (const step of steps) for (const piece of step.pieces) if (piece.kind === "note")
    for (const { part } of piece.items) if (part.kind === "link")
      part.target = part.name ? find(steps, step, part.name, part.direction) : part.direction === "any" ? undefined : same(steps, step, part.direction);
  return { steps, roots, tail: code.slice(last) };
}

export const stepCode = (step: CallTreeStep) => step.pieces.map((piece) => piece.kind === "code" ? piece.text : "").join("");

// The strings the highlighter colors, blanked out so a parenthesis or separator inside one never counts.
const strings = /"[^"\n]*"|(?<![\w'])'[^'\n]*'(?![\w'])/g;
const blank = (text: string) => text.replace(strings, (match) => match[0] + " ".repeat(match.length - 2) + match[0]);

function pieces(text: string): CallTreePiece[] {
  const plain = blank(text);
  const found: CallTreePiece[] = [];
  let from = 0;
  for (let index = 0; index < text.length; index++) {
    if (plain[index] !== "(" || (index > 0 && !/\s/.test(plain[index - 1])) || !keyword.test(text.slice(index + 1))) continue;
    const close = closing(plain, index);
    if (close < 0) continue;
    if (index > from) found.push({ kind: "code", text: text.slice(from, index) });
    const before = found.map((piece) => piece.kind === "code" ? piece.text : "").join("");
    found.push(note(text.slice(index + 1, close), plain.slice(index + 1, close), subject(blank(before))));
    from = index = close + 1;
    index--;
  }
  if (from < text.length) found.push({ kind: "code", text: text.slice(from) });
  return found;
}

function note(inner: string, plain: string, subject?: string): CallTreePiece {
  const items: { before: string; part: CallTreePart }[] = [];
  let before = "(";
  let start = 0;
  let depth = 0;
  const take = (end: number, next: string) => {
    items.push({ before, part: part(inner.slice(start, end), subject) });
    before = next;
  };
  for (let index = 0; index < plain.length; index++) {
    if (plain[index] === "(") depth++;
    if (plain[index] === ")") depth--;
    if (depth) continue;
    const separator = plain.slice(index).match(/^;\s*|^,\s+(?=(?:existing|changed|the service|see\s|PR \d+)\b)/)?.[0];
    if (!separator) continue;
    take(index, separator);
    start = index + separator.length;
    index = start - 1;
  }
  take(inner.length, "");
  return { kind: "note", items, after: ")" };
}

function part(raw: string, subject?: string): CallTreePart {
  const split = raw.match(/^(.*?)(:\s+)(.*)$/s);
  const label = split?.[1] ?? raw;
  const fields = { separator: split?.[2] ?? "", detail: split?.[3] ?? "" };
  if (/^(?:above|below)$/.test(label)) return { kind: "link", label, name: subject, direction: label as "above" | "below", ...fields };
  const see = label.match(/^see\s+(.+)$/);
  if (see) return { kind: "link", label, name: see[1], direction: "any", ...fields };
  if (/^(?:existing|changed|the service|PR \d+)\b/.test(label)) return { kind: "mark", label, changed: label.startsWith("changed"), ...fields };
  return { kind: "text", text: raw };
}

// The call a note follows: `insertTodoEvent({ todoId }) (above)` points at insertTodoEvent.
function subject(text: string) {
  const end = text.trimEnd();
  if (!end.endsWith(")")) return end.match(name)?.[0];
  let depth = 0;
  for (let index = end.length - 1; index >= 0; index--) {
    if (end[index] === ")") depth++;
    if (end[index] === "(" && --depth === 0) return end.slice(0, index).match(name)?.[0];
  }
}

function closing(plain: string, open: number) {
  let depth = 0;
  for (let index = open; index < plain.length; index++) {
    if (plain[index] === "(") depth++;
    if (plain[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

function names(step: CallTreeStep, wanted: string) {
  const texts = [{ text: stepCode(step).trimStart(), rank: 0 }];
  let best: number | undefined;
  for (const { text, rank } of texts) {
    if (text.startsWith(wanted) && !/[\w$.]/.test(text[wanted.length] ?? "")) best = Math.min(best ?? rank, rank);
    for (const [prefix, more] of [...prefixes.map((prefix) => [prefix, 0] as const), [condition, 1] as const]) {
      const rest = text.replace(prefix, "");
      if (rest !== text) texts.push({ text: rest, rank: rank + more });
    }
  }
  return best;
}

// `if !(await canUseTodos(req, ctx)): -> 403 (above)` follows no call, so it points at the same step written above, where it shows its steps.
function same(steps: CallTreeStep[], from: CallTreeStep, direction: "above" | "below") {
  const code = stepCode(from).trim();
  const list = steps.filter((step) => step !== from && stepCode(step).trim().startsWith(code) && (direction === "above" ? step.id < from.id : step.id > from.id));
  const nearest = direction === "above" ? list.reverse() : list;
  return nearest.find((step) => step.children.length) ?? nearest[0];
}

// A step that makes the call and shows its own steps is where a reference to it goes.
function find(steps: CallTreeStep[], from: CallTreeStep, wanted: string, direction: "above" | "below" | "any") {
  const all = steps.flatMap((step) => {
    const rank = step === from ? undefined : names(step, wanted);
    return rank === undefined ? [] : [{ step, rank }];
  });
  const best = (list: typeof all) => {
    for (const rank of [...new Set(list.map((entry) => entry.rank))].sort()) {
      const ranked = list.filter((entry) => entry.rank === rank).map((entry) => entry.step);
      const found = ranked.find((step) => step.children.length) ?? (direction === "above" ? ranked.at(-1) : ranked[0]);
      if (found) return found;
    }
  };
  return best(all.filter(({ step }) => direction === "any" || (direction === "above" ? step.id < from.id : step.id > from.id))) ?? best(all);
}
