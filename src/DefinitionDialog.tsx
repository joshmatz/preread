import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Package, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Popover } from "./Popover";
import { SourceExplorer, explorerChanges, whenLaidOut, type Reveal } from "./SourceExplorer";
import { SidebarResizer } from "./SidebarResizer";
import type { ChangedFile, Mode } from "./types";
import { BriefDialog } from "./BriefDialog";
import { HighlightedCode } from "./HighlightedCode";
import { diffRows, drawDiff, rowAt } from "./draw-diff";
import { displayedPatch } from "./whitespace-diff";
import { AUTO_RENDER_LINES, diffSize } from "./diff-size";
import { firstChange } from "./diff-context";
import type { DiffFile } from "diff2html/lib/types";

const mac = /Mac|iPad|iPhone/.test(navigator.platform);
export const definitionModifier = (event: { metaKey: boolean; ctrlKey: boolean }) =>
  mac ? event.metaKey : event.ctrlKey;

export function useDefinitionModifier() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = (event: KeyboardEvent | PointerEvent) =>
      root.classList.toggle("definition-modifier", definitionModifier(event));
    const reset = () => root.classList.remove("definition-modifier");
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("pointermove", sync);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("pointermove", sync);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      reset();
    };
  }, []);
}

// Diff rows supply their own Git line numbers. In a full file, preserve each
// token's source position across newlines and nested syntax-highlight spans.
export function definitionButtons(block: Element) {
  const source = block.textContent ?? "";
  const lines = source.split("\n");
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: { text: Text; offset: number }[] = [];
  let offset = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    nodes.push({ text, offset });
    offset += text.length;
  }
  // Work backwards so splitting a node preserves all earlier offsets.
  let lineEnd = source.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const lineStart = lineEnd - line.length;
    lineEnd = lineStart - 1;
    if (line.length > 10_000) continue;
    const calls = [...line.matchAll(/(?<![\w$])([a-zA-Z_$][\w$]*)(?=\s*(?:\?\.\s*)?(?:<[^<>();]+>\s*)?\()/g)];
    for (const match of calls.reverse()) {
      const name = match[0];
      if (/^(if|for|while|switch|catch|function|return|await|new|typeof|void|throw|import|super|with)$/.test(name)) continue;
      const position = lineStart + match.index!;
      while (nodes.length && nodes[nodes.length - 1].offset > position) nodes.pop();
      const node = nodes.at(-1);
      if (!node || node.text.parentElement?.closest(".hljs-string,.hljs-comment,.hljs-regexp,.hljs-keyword")) continue;
      const within = position - node.offset;
      if (within + name.length > node.text.length) continue;
      const token = node.text.splitText(within);
      token.splitText(name.length);
      const button = document.createElement("button");
      button.className = "definition-call";
      button.setAttribute("aria-label", "Open definition of " + name);
      button.dataset.column = String(match.index);
      button.dataset.line = String(i + 1);
      token.replaceWith(button);
      button.append(token);
    }
  }
}

export type Side = "old" | "new";
type PackageInfo = { name: string; version: string };
type FileDiff = { patch: string; path: string; oldPath?: string };
type SourceFile = { file: string; code: string; editorTarget: string | null; package?: PackageInfo; diff?: FileDiff };
export type Definition = SourceFile & { line?: number; paths: string[]; changes: ChangedFile[] };
export type DefinitionSource = { path: string; base: string; mode: Mode; version: string };

// One short message beside the call, in the top layer so it also shows above the open viewer.
let dismissHint = () => {};
export const hideDefinitionHint = () => dismissHint();
function showDefinitionHint(anchor: Element, text: string, busy = false) {
  dismissHint();
  if (!anchor.isConnected) return;
  const hint = document.createElement("div");
  hint.className = "definition-hint";
  hint.setAttribute("popover", "manual");
  hint.setAttribute("role", "status");
  document.body.append(hint);
  hint.showPopover();
  hint.textContent = text;
  const bounds = anchor.getBoundingClientRect();
  const below = bounds.bottom + 8 + hint.offsetHeight <= innerHeight - 8;
  hint.style.left = `${Math.max(8, Math.min(bounds.left - 4, innerWidth - hint.offsetWidth - 8))}px`;
  hint.style.top = `${below ? bounds.bottom + 6 : Math.max(8, bounds.top - hint.offsetHeight - 6)}px`;
  const close = () => dismissHint();
  const timer = busy ? undefined : setTimeout(close, 4000);
  const events = ["pointerdown", "keydown", "wheel"];
  if (!busy) for (const type of events) addEventListener(type, close, { capture: true, passive: true });
  dismissHint = () => {
    clearTimeout(timer);
    for (const type of events) removeEventListener(type, close, { capture: true });
    hint.remove();
    dismissHint = () => {};
  };
}

let pendingLookup: AbortController | null = null;
const cancelLookup = () => {
  pendingLookup?.abort();
  dismissHint();
};
async function lookup(url: string, anchor: HTMLElement, waiting: string, failed: string) {
  pendingLookup?.abort();
  const controller = (pendingLookup = new AbortController());
  dismissHint();
  anchor.setAttribute("aria-busy", "true");
  const slow = setTimeout(() => showDefinitionHint(anchor, waiting, true), 350);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || failed);
    dismissHint();
    return data as Definition;
  } catch (error) {
    if (!controller.signal.aborted) showDefinitionHint(anchor, error instanceof Error ? error.message : failed);
    return null;
  } finally {
    clearTimeout(slow);
    anchor.removeAttribute("aria-busy");
    if (pendingLookup === controller) pendingLookup = null;
  }
}
export const lookupDefinition = (params: URLSearchParams, anchor: HTMLElement) =>
  lookup("/api/definition?" + params, anchor, "Finding definition…", "No definition found.");
export const openSourceFile = (params: URLSearchParams, anchor: HTMLElement) =>
  lookup("/api/source-file?tree=1&" + params, anchor, "Opening the file…", "Could not open the file.");

function useRead<T>(url: string) {
  const [state, setState] = useState<{ url: string; data?: T; error?: string }>();
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    async function load() {
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read the source.");
      if (!controller.signal.aborted) setState({ url, data });
    }
    load().catch(e => { if (!controller.signal.aborted) setState({ url, error: e.message }); });
    return () => controller.abort();
  }, [url]);
  return state?.url === url ? state : undefined;
}

function EditorButton({ editors, url, target, line }: { editors: string[]; url: string; target: string; line: number }) {
  const [saved, setSaved] = useState(() => {
    try { return localStorage.getItem("preread-editor"); } catch { return null; }
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = saved && editors.includes(saved) ? saved : editors[0];
  async function launch(editor: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editor, line, editorTarget: target }) });
      if (!res.ok) throw new Error((await res.json()).error || "Could not open the file.");
      setSaved(editor);
      try { localStorage.setItem("preread-editor", editor); } catch { /* Optional preference. */ }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open the file."); }
    finally { setBusy(false); }
  }
  return <>
    <div className="editor-launch">
      <button disabled={busy} onClick={() => launch(chosen)}><ExternalLink size={14} />{chosen === "Finder" ? "Reveal in Finder" : "Open in " + chosen}</button>
      {editors.length > 1 && <Popover className="choose-editor" label="Installed editors" title="Choose an editor" width={170}
        panel={close => editors.map(editor => <button className="editor-choice" key={editor} disabled={busy}
          onClick={() => { close(); void launch(editor); }}>{editor}</button>)}>
        <ChevronDown size={14} />
      </Popover>}
    </div>
    {error && <p role="alert" className="warning">{error}</p>}
  </>;
}

function SourcePath({ path, line, pkg, onReveal }: {
  path: string; line?: number; pkg?: PackageInfo; onReveal: (path: string, folder: boolean) => void;
}) {
  const parts = path.split("/");
  return <nav className="source-path" aria-label="File path">
    <ol>
      {parts.map((part, i) => {
        const folder = i < parts.length - 1;
        const target = parts.slice(0, i + 1).join("/");
        return <li key={target}>
          {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
          <button type="button" className={folder ? undefined : "source-file-name"} aria-current={folder ? undefined : "page"}
            title={folder ? "Show " + target + " in the Explorer" : "Show in the Explorer"} onClick={() => onReveal(target, folder)}>
            {part}{!folder && line ? <span className="source-line">:{line}</span> : null}
          </button>
        </li>;
      })}
    </ol>
    {pkg && <span className="package-chip" title="Installed in this worktree. It is not part of the review.">
      <Package size={13} />{pkg.name}{pkg.version && <span>{pkg.version}</span>}
    </span>}
  </nav>;
}

const LINE = 20;
const lineCount = (code: string) => Math.max(1, code.split("\n").length - (code.endsWith("\n") ? 1 : 0));

function SourceCode({ file, line, restore, visit, scroller, onFollow }: {
  file: SourceFile; line?: number; restore?: number; visit: number;
  scroller: React.RefObject<HTMLDivElement | null>; onFollow: (button: HTMLButtonElement) => void;
}) {
  const count = useMemo(() => lineCount(file.code), [file.code]);
  const numbers = useMemo(() => Array.from({ length: count }, (_, i) => i + 1).join("\n"), [count]);
  useLayoutEffect(() => {
    const pane = scroller.current!;
    return whenLaidOut(pane, () => {
      pane.scrollLeft = 0;
      // A third of the way down leaves room for the comment above a definition.
      pane.scrollTop = restore ?? (line ? (line - 1) * LINE - pane.clientHeight / 3 : 0);
    });
  }, [file, line, restore, visit, scroller]);
  const ext = file.file.split(".").at(-1) ?? "";
  const lang = /^[cm]?tsx?$/.test(ext) ? "typescript" : /^[cm]?jsx?$/.test(ext) ? "javascript" : ext;
  return <div ref={scroller} className="source-scroll" onClick={event => {
    const button = event.target instanceof Element && event.target.closest<HTMLButtonElement>(".definition-call");
    if (button && (event.detail === 0 || definitionModifier(event))) onFollow(button);
  }}>
    <div className="source-sheet" style={{ "--digits": String(count).length, "--target-row": (line ?? 0) - 1 } as React.CSSProperties}>
      <div className="source-gutter" aria-hidden="true">
        {line ? <span key={visit} className="source-target" /> : null}
        <span className="source-numbers">{numbers}</span>
      </div>
      {line ? <span key={visit} className="source-target" aria-hidden="true" /> : null}
      <pre className="definition-code" aria-label={file.file}>
        <HighlightedCode code={file.code} language={file.code.length > 100_000 ? "plaintext" : lang}
          decorate={lang === "typescript" || lang === "javascript" ? definitionButtons : undefined} />
      </pre>
    </div>
  </div>;
}

const scripts = /\.[cm]?[jt]sx?$/i;

type Row = { side: Side; line: number };

function SourceDiff({ diff, displayed, target, restore, visit, scroller, split, wrap, ignoreWhitespace, onFollow }: {
  diff: FileDiff; displayed: string | DiffFile[]; target?: Row; restore?: number; visit: number;
  scroller: React.RefObject<HTMLDivElement | null>; split: boolean; wrap: boolean; ignoreWhitespace: boolean;
  onFollow: (button: HTMLButtonElement, at: { file: string; side: Side; line: number }) => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = sheet.current!;
    const { plus, minus } = diffSize(diff.patch);
    drawDiff(element, displayed, {
      split, ignoreWhitespace, matching: plus + minus < AUTO_RENDER_LINES ? "lines" : "none",
      decorate: scripts.test(diff.path) ? definitionButtons : undefined,
    });
    // The whole file is one block, so its heading would only repeat the line counts.
    for (const heading of element.querySelectorAll("td.d2h-info")) heading.closest("tr")!.remove();
    return () => { element.innerHTML = ""; };
  }, [diff, displayed, split, ignoreWhitespace]);
  useLayoutEffect(() => {
    const pane = scroller.current!;
    const element = sheet.current!;
    return whenLaidOut(pane, () => {
      for (const row of element.querySelectorAll(".source-target-row")) row.classList.remove("source-target-row");
      const row = target && rowAt(element, split, target.side, target.line);
      if (row) {
        const { sides } = diffRows(element, split);
        const table = sides.findIndex(rows => rows.includes(row));
        const index = sides[table].indexOf(row);
        // Reflow between removing and adding the class, so the arrival animation replays.
        void element.offsetWidth;
        for (const rows of split ? [sides[table], sides[table ^ 1]] : [sides[table]]) rows?.[index]?.classList.add("source-target-row");
      }
      const first = firstChange(diff.patch);
      const anchor = row || (first && rowAt(element, split, first.side, first.line));
      const top = anchor ? anchor.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop : 0;
      pane.scrollLeft = 0;
      pane.scrollTop = restore ?? (anchor ? top - pane.clientHeight / 3 : 0);
    });
  }, [diff, displayed, target?.side, target?.line, restore, visit, split, scroller]);
  return <div ref={scroller} className="source-scroll" onClick={event => {
    const button = event.target instanceof Element && event.target.closest<HTMLButtonElement>(".definition-call");
    if (!button || !(event.detail === 0 || definitionModifier(event))) return;
    const key = diffRows(sheet.current!, split).keyOf(button);
    if (!key) return;
    const [at, number] = key.split(":") as [Side, string];
    onFollow(button, { file: at === "old" ? diff.oldPath ?? diff.path : diff.path, side: at, line: Number(number) });
  }}>
    <div ref={sheet} className={`diff-renderer source-diff${wrap ? " wrap-lines" : ""}`} />
  </div>;
}

// A file card opens on its first change, which can be a removed line, so it lands on a diff row rather than a line.
type Place = { file: string; side: Side; line?: number; change?: Row; scrollTop?: number };
const placeKey = (file: string, side: Side) => side + ":" + file;
const explorerShown = () => {
  try {
    const saved = localStorage.getItem("preread-source-explorer");
    if (saved) return saved === "shown";
  } catch { /* Optional preference. */ }
  return window.innerWidth > 580;
};

export function DefinitionDialog({ source, side, initial, change, split, wrap, ignoreWhitespace, onClose }: {
  source: DefinitionSource; side: Side; initial: Definition; change?: Row; split: boolean; wrap: boolean; ignoreWhitespace: boolean;
  onClose: () => void;
}) {
  const editors = useRead<string[]>("/api/editors");
  const [showExplorer, setShowExplorer] = useState(explorerShown);
  const [history, setHistory] = useState({ places: [{ file: initial.file, side, line: initial.line, change }] as Place[], index: 0, visit: 0 });
  const [files, setFiles] = useState(() => new Map<string, SourceFile | { error: string }>([[placeKey(initial.file, side), initial]]));
  const [installed, setInstalled] = useState<string[]>(() => initial.package ? [initial.file] : []);
  const [reveal, setReveal] = useState<Reveal>();
  const scroller = useRef<HTMLDivElement>(null);
  const changes = useMemo(() => explorerChanges(initial.changes), [initial]);
  const paths = useMemo(() => [...initial.paths, ...installed], [initial, installed]);
  const place = history.places[history.index];
  const key = placeKey(place.file, place.side);
  const loaded = files.get(key);
  const current = loaded && !("error" in loaded) ? loaded : undefined;
  const params = new URLSearchParams({ ...source, side: place.side, file: place.file });
  const displayed = useMemo(() => current?.diff && displayedPatch(current.diff.patch, ignoreWhitespace), [current?.diff, ignoreWhitespace]);
  // With whitespace ignored, a reindented file can have no changed lines left to show.
  const changed = typeof displayed === "string" || !!displayed?.some(file => file.blocks.some(block => block.lines.length));

  useEffect(() => {
    if (files.has(key)) return;
    const controller = new AbortController();
    fetch("/api/source-file?" + params, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read the source.");
      return data as SourceFile;
    }).then(
      data => setFiles(previous => new Map(previous).set(key, data)),
      error => { if (!controller.signal.aborted) setFiles(previous => new Map(previous).set(key, { error: error.message })); },
    );
    return () => controller.abort();
  }, [key]);
  useEffect(() => cancelLookup, []);

  // Moving on drops a lookup still in flight, so a slow answer can't pull the reader back.
  function go(next: Place | number) {
    cancelLookup();
    const scrollTop = scroller.current?.scrollTop;
    setHistory(({ places, index, visit }) => {
      const kept = places.map((p, i) => i === index ? { ...p, scrollTop } : p);
      if (typeof next === "number") {
        const to = index + next;
        return to < 0 || to >= kept.length ? { places, index, visit } : { places: kept, index: to, visit: visit + 1 };
      }
      const trail = kept.slice(0, index + 1);
      return { places: [...trail, next], index: trail.length, visit: visit + 1 };
    });
  }
  const step = useRef(go);
  step.current = go;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!definitionModifier(event) || event.shiftKey || event.altKey || (event.key !== "[" && event.key !== "]")) return;
      event.preventDefault();
      step.current(event.key === "[" ? -1 : 1);
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  }, []);

  function selectFile(path: string) {
    if (path === place.file) return;
    go({ file: path, side: path.split("/").includes("node_modules") ? place.side : changes.get(path)?.side ?? side });
  }
  async function follow(button: HTMLButtonElement, at = { file: place.file, side: place.side, line: Number(button.dataset.line) }) {
    const target = new URLSearchParams({ ...source, file: at.file, side: at.side, line: String(at.line),
      column: button.dataset.column!, name: button.textContent! });
    const data = await lookupDefinition(target, button);
    if (!data) return;
    setFiles(previous => new Map(previous).set(placeKey(data.file, at.side), data));
    if (data.package) setInstalled(previous => previous.includes(data.file) ? previous : [...previous, data.file]);
    go({ file: data.file, side: at.side, line: data.line });
  }
  function toggleExplorer(show: boolean) {
    setShowExplorer(show);
    try { localStorage.setItem("preread-source-explorer", show ? "shown" : "hidden"); } catch { /* Optional preference. */ }
  }

  const back = mac ? "⌘[" : "Ctrl+[";
  const forward = mac ? "⌘]" : "Ctrl+]";
  const toggleLabel = showExplorer ? "Hide Explorer" : "Show Explorer";
  const ToggleIcon = showExplorer ? PanelLeftClose : PanelLeftOpen;
  return <BriefDialog title={place.file + (place.line ? ":" + place.line : "")} fullscreen onClose={onClose}
    closeLabel="Close the source viewer"
    leading={<div className="source-history">
      <button title={toggleLabel} aria-label={toggleLabel} aria-controls="worktree-explorer"
        aria-expanded={showExplorer} onClick={() => toggleExplorer(!showExplorer)}><ToggleIcon size={17} /></button>
      <button title={`Back (${back})`} aria-label="Back" disabled={history.index === 0} onClick={() => go(-1)}><ArrowLeft size={16} /></button>
      <button title={`Forward (${forward})`} aria-label="Forward" disabled={history.index === history.places.length - 1}
        onClick={() => go(1)}><ArrowRight size={16} /></button>
    </div>}
    heading={<SourcePath path={place.file} line={place.line} pkg={current?.package} onReveal={(path, folder) => {
      toggleExplorer(true);
      setReveal({ path, folder });
    }} />}
    actions={current?.editorTarget && editors?.data?.length ? <EditorButton key={place.file} editors={editors.data}
      url={"/api/open-source?" + params} target={current.editorTarget} line={place.line ?? 1} /> : null}>
    <div className={"source-browser" + (showExplorer ? "" : " explorer-hidden")}>
      <SourceExplorer paths={paths} changes={changes} file={place.file} reveal={reveal} onSelect={selectFile} />
      <SidebarResizer storageKey="sourceExplorerWidth" label="Resize Explorer" />
      <section className="source-pane">
        {current?.editorTarget === null && <p className="source-notice">Showing the reviewed version. The file on disk is different or gone.</p>}
        {current?.diff && changed ? <SourceDiff diff={current.diff} displayed={displayed!}
          target={place.line ? { side: place.side, line: place.line } : place.change} restore={place.scrollTop} visit={history.visit} scroller={scroller} split={split} wrap={wrap}
          ignoreWhitespace={ignoreWhitespace} onFollow={follow} />
          : current ? <SourceCode file={current} line={place.line} restore={place.scrollTop} visit={history.visit}
            scroller={scroller} onFollow={follow} />
          : <p role="status" className="source-notice">{loaded && "error" in loaded ? loaded.error : "Loading source…"}</p>}
      </section>
    </div>
  </BriefDialog>;
}
