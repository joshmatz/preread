import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseCallTree, stepCode, type CallTree as Tree, type CallTreePart, type CallTreePiece, type CallTreeStep } from "./call-tree";
import { highlightLines } from "./highlight";
import { textOffset } from "./brief-selection";

type View = "outline" | "text";
type Shown = { code: string; open: Set<number>; view: View };
type Go = (target: CallTreeStep) => void;
const shownAtFirst = 60;
// The brief unmounts while Feedback shows; keeping each tree's folds and view brings the reader back to the same place.
const kept = new Map<string, Shown>();

// Both views hold the source text exactly, hiding it where a chip stands in, so a comment's quote and offsets match either one.
// Labels the reader sees but the source lacks are drawn from data-label, which keeps them out of that text.
export function CallTree({ code, heading, textId, marks = [] }: {
  code: string; heading?: ReactNode; textId?: string; marks?: Array<[number, number]>;
}) {
  const tree = useMemo(() => parseCallTree(code), [code]);
  const html = useMemo(() => highlightPieces(tree), [tree]);
  const [state, setState] = useState(() => kept.get(code) ?? fresh(code, tree));
  const shown = state.code === code ? state : kept.get(code) ?? fresh(code, tree);
  if (shown !== state) setState(shown);
  const { open, view } = shown;
  useEffect(() => { kept.set(shown.code, shown); }, [shown]);
  const [jump, setJump] = useState<{ id: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const switched = useRef(false);
  const setOpen = (next: (open: Set<number>) => Set<number>) => setState((current) => {
    const open = next(current.open);
    return open === current.open ? current : { ...current, open };
  });
  const setView = (view: View) => setState((current) => ({ ...current, view }));
  const go: Go = (target) => {
    setOpen((current) => new Set([...current, ...ancestors(target)]));
    setJump({ id: target.id });
  };
  useLayoutEffect(() => {
    const row = jump && root.current?.querySelector<HTMLElement>(`[data-step="${jump.id}"] > .call-tree-row`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.focus({ preventScroll: true });
    const flash = getComputedStyle(row).getPropertyValue("--call-tree-flash").trim();
    row.animate([{ backgroundColor: flash }, { backgroundColor: flash, offset: 0.35 }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
  }, [jump]);
  // A comment's offsets count from the start of its brief block, which in Markdown holds more than this tree.
  useLayoutEffect(() => {
    const outline = root.current?.querySelector<HTMLElement>(".call-tree-outline");
    const block = outline?.closest<HTMLElement>("[data-brief-text]");
    if (!outline || !block || !marks.length) return;
    const base = textOffset(block, outline, 0);
    const marked = openForMarks(tree, marks.map(([start, end]): [number, number] => [start - base, end - base]));
    setOpen((current) => [...marked].every((id) => current.has(id)) ? current : new Set([...current, ...marked]));
  }, [tree, view]);
  // Comment highlights hold ranges in the view that was showing, so the brief measures them again.
  useLayoutEffect(() => {
    if (switched.current) root.current?.dispatchEvent(new Event("preread-text-change", { bubbles: true }));
    switched.current = true;
  }, [view]);
  const counts = useMemo(() => new Map(tree.steps.map((step) => [step.id, descendants(step)])), [tree]);
  const toggle = (id: number) => setOpen((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const folding = tree.steps.some((step) => step.children.length);
  return <div className="call-tree" ref={root}>
    <div className="call-tree-bar">
      {heading && <span className="call-tree-heading">{heading}</span>}
      <div className="call-tree-tools">
        {view === "outline" && folding && <>
          <button type="button" aria-label="Expand all" data-label="Expand all"
            onClick={() => setOpen(() => new Set(tree.steps.filter((step) => step.children.length).map((step) => step.id)))} />
          <button type="button" aria-label="Collapse all" data-label="Collapse all" onClick={() => setOpen(() => new Set())} />
        </>}
        <div className="segmented" role="group" aria-label="Show the call tree as">
          <button type="button" aria-pressed={view === "outline"} aria-label="Outline" data-label="Outline" onClick={() => setView("outline")} />
          <button type="button" aria-pressed={view === "text"} aria-label="Text" data-label="Text" onClick={() => setView("text")} />
        </div>
      </div>
    </div>
    {view === "outline"
      ? <div className="call-tree-outline" data-brief-text={textId}>
        {tree.roots.map((step) => <Step key={step.id} step={step} open={open} counts={counts} html={html} toggle={toggle} go={go} />)}
        <span hidden>{tree.tail}</span>
      </div>
      : <Source code={code} textId={textId} />}
  </div>;
}

function Step({ step, open, counts, html, toggle, go }: {
  step: CallTreeStep; open: Set<number>; counts: Map<number, number>; html: Map<CallTreePiece, string>; toggle: (id: number) => void; go: Go;
}) {
  const expanded = open.has(step.id);
  const under = counts.get(step.id) ?? 0;
  const lines = `${under} ${under === 1 ? "line" : "lines"}`;
  return <div className={`call-tree-step${step.depth ? "" : " root"}`} data-step={step.id}>
    <div className="call-tree-row" tabIndex={-1}>
      {step.children.length
        ? <button type="button" className="call-tree-toggle" aria-expanded={expanded} aria-label={`${lines} under ${clip(stepCode(step).trim(), 60) || "this step"}`}
          onClick={() => toggle(step.id)} />
        : <span />}
      <span className="call-tree-code">
        <span hidden>{step.lead}</span>
        {step.pieces.map((piece, index) => piece.kind === "code"
          ? <span key={index} dangerouslySetInnerHTML={{ __html: html.get(piece) ?? "" }} />
          : <Note key={index} piece={piece} from={step} go={go} />)}
        {step.children.length > 0 && !expanded
          && <button type="button" className="call-tree-more" data-label={lines} tabIndex={-1} aria-hidden="true" onClick={() => toggle(step.id)} />}
      </span>
    </div>
    {step.children.length > 0 && <div className="call-tree-children" hidden={!expanded}>
      {step.children.map((child) => <Step key={child.id} step={child} open={open} counts={counts} html={html} toggle={toggle} go={go} />)}
    </div>}
  </div>;
}

function Note({ piece, from, go }: { piece: Extract<CallTreePiece, { kind: "note" }>; from: CallTreeStep; go: Go }) {
  return <span className="call-tree-note">
    {piece.items.map(({ before, part }, index) => {
      const previous = piece.items[index - 1]?.part;
      const spoken = !!previous && (part.kind === "text" || previous.kind === "text" || previous.detail !== "");
      return <React.Fragment key={index}>
        {spoken ? <span className="call-tree-detail">{before}</span> : <span hidden>{before}</span>}
        <Part part={part} from={from} go={go} />
      </React.Fragment>;
    })}
    <span hidden>{piece.after}</span>
  </span>;
}

function Part({ part, from, go }: { part: CallTreePart; from: CallTreeStep; go: Go }) {
  if (part.kind === "text") return <span className="call-tree-detail">{part.text}</span>;
  const rest = <>{part.separator && <span hidden>{part.separator}</span>}{part.detail && <span className="call-tree-detail">{part.detail}</span>}</>;
  if (part.kind === "link" && part.target) {
    const target = part.target;
    const where = target.id < from.id ? "above" : "below";
    const name = part.name ?? `same as ${where}`;
    return <><button type="button" className="call-tree-link" data-label={`${where === "above" ? "↑" : "↓"} ${name}`}
      aria-label={`Go to ${part.name ?? "the same step"}, ${where}`} title={clip(stepCode(target).trim(), 140)}
      onClick={() => go(target)}><span hidden>{part.label}</span></button>{rest}</>;
  }
  return <><span className={`call-tree-mark${part.kind === "mark" && part.changed ? " changed" : ""}`}>{part.label}</span>{rest}</>;
}

function Source({ code, textId }: { code: string; textId?: string }) {
  const lines = useMemo(() => {
    const text = code.replace(/\n$/, "").split("\n");
    return { text, html: highlightLines(text, "call-tree") };
  }, [code]);
  return <div className="call-tree-text hljs language-call-tree" data-brief-text={textId}>
    {lines.text.map((line, index) => <div key={index} className="call-tree-line"
      style={{ "--indent": line.length - line.trimStart().length } as CSSProperties}>
      {index > 0 && <span hidden>{"\n"}</span>}
      <span dangerouslySetInnerHTML={{ __html: lines.html[index] }} />
    </div>)}
    {code.endsWith("\n") && <span hidden>{"\n"}</span>}
  </div>;
}

// A space leads each piece so its first word never reads as a tree's first line, which the language bolds.
function highlightPieces(tree: Tree) {
  const html = new Map<CallTreePiece, string>();
  for (const step of tree.steps) for (const piece of step.pieces)
    if (piece.kind === "code") html.set(piece, highlightLines([` ${piece.text}`], "call-tree")[0].slice(1));
  return html;
}

const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text;
const descendants = (step: CallTreeStep): number => step.children.reduce((total, child) => total + 1 + descendants(child), 0);
const ancestors = (step: CallTreeStep) => {
  const ids: number[] = [];
  for (let parent = step.parent; parent; parent = parent.parent) ids.push(parent.id);
  return ids;
};

const fresh = (code: string, tree: Tree): Shown => ({ code, open: initialOpen(tree), view: "outline" });

export function initialOpen(tree: Tree) {
  const open = new Set<number>();
  let shown = tree.roots.length;
  for (let depth = 0; ; depth++) {
    const level = tree.steps.filter((step) => step.depth === depth && step.children.length);
    const added = level.reduce((total, step) => total + step.children.length, 0);
    if (!level.length || (depth > 0 && shown + added > shownAtFirst)) break;
    level.forEach((step) => open.add(step.id));
    shown += added;
  }
  return open;
}

export const openForMarks = (tree: Tree, marks: Array<[number, number]>) => new Set(tree.steps
  .filter((step) => marks.some(([start, end]) => step.start < end && start < step.end)).flatMap(ancestors));
