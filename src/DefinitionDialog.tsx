import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalLink, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Popover } from "./Popover";
import { SourceExplorer, explorerChanges } from "./SourceExplorer";
import { SidebarResizer } from "./SidebarResizer";
import type { ChangedFile } from "./types";
import { BriefDialog } from "./BriefDialog";
import { HighlightedCode } from "./HighlightedCode";

export const definitionModifier = (event: { metaKey: boolean; ctrlKey: boolean }) =>
  /Mac|iPad|iPhone/.test(navigator.platform) ? event.metaKey : event.ctrlKey;

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

type SourceFile = { file: string; code: string; editorTarget: string | null };
type Definition = SourceFile & { line: number; paths: string[]; changes: ChangedFile[] };

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

function SourceCode({ file, line, onFollow }: { file: SourceFile; line?: number; onFollow: (button: HTMLButtonElement) => void }) {
  const pre = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const element = pre.current!;
    element.scrollTop = ((line ?? 1) - 1) * parseFloat(getComputedStyle(element).lineHeight);
    element.scrollLeft = 0;
  }, [file, line]);
  const ext = file.file.split(".").at(-1) ?? "";
  const lang = /^[cm]?tsx?$/.test(ext) ? "typescript" : /^[cm]?jsx?$/.test(ext) ? "javascript" : ext;
  return <pre ref={pre} className="definition-code" aria-label={file.file}
    style={line ? { "--definition-row": line - 1 } as React.CSSProperties : undefined}
    onClick={event => {
      const button = event.target instanceof Element && event.target.closest<HTMLButtonElement>(".definition-call");
      if (button && (event.detail === 0 || definitionModifier(event))) onFollow(button);
    }}>
    <HighlightedCode code={file.code} language={file.code.length > 100_000 ? "plaintext" : lang}
      decorate={lang === "typescript" || lang === "javascript" ? definitionButtons : undefined} />
  </pre>;
}

export function DefinitionDialog({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const definition = useRead<Definition>(url);
  const editors = useRead<string[]>("/api/editors");
  const [selected, setSelected] = useState("");
  const [showExplorer, setShowExplorer] = useState(() => window.innerWidth > 580);
  const [jump, setJump] = useState<{ file: Definition; side: string }>();
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const entry = jump?.file ?? definition?.data;
  const changes = useMemo(() => explorerChanges(entry?.changes ?? []), [entry]);
  const currentPath = selected || entry?.file || "";
  const atDefinition = currentPath === entry?.file;
  const params = new URL(url, location.href).searchParams;
  params.set("file", currentPath);
  const entrySide = jump?.side ?? params.get("side")!;
  const side = atDefinition ? entrySide : changes.get(currentPath)?.side ?? entrySide;
  params.set("side", side);
  const otherFile = useRead<SourceFile>(selected && !atDefinition ? "/api/source-file?" + params : "");
  const current = atDefinition ? entry : otherFile?.data;
  const line = atDefinition && entry ? entry.line : 1;
  function selectFile(path: string) {
    pending.current?.abort();
    setNotice("");
    setSelected(path);
  }

  async function follow(button: HTMLButtonElement) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const target = new URLSearchParams(params);
    target.set("name", button.textContent!);
    target.set("line", button.dataset.line!);
    target.set("column", button.dataset.column!);
    setNotice("Locating definition…");
    try {
      const response = await fetch("/api/definition?" + target, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read the definition.");
      if (controller.signal.aborted) return;
      setJump({ file: data, side });
      setSelected("");
      setNotice("");
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not read the definition.");
    }
  }

  const toggleLabel = showExplorer ? "Hide Explorer" : "Show Explorer";
  const ToggleIcon = showExplorer ? PanelLeftClose : PanelLeftOpen;
  return <BriefDialog title={currentPath ? currentPath + ":" + line : name} fullscreen onClose={onClose}
    leading={entry && <button title={toggleLabel} aria-label={toggleLabel} aria-controls="worktree-explorer"
      aria-expanded={showExplorer} onClick={() => setShowExplorer(!showExplorer)}><ToggleIcon size={17}/></button>}
    actions={current?.editorTarget && editors?.data?.length ? <EditorButton key={currentPath} editors={editors.data}
      url={"/api/open-source?" + params} target={current.editorTarget} line={line} /> : null}>
    {entry ? <div className={"source-browser" + (showExplorer ? "" : " explorer-hidden")}>
      <SourceExplorer paths={entry.paths} changes={changes} file={currentPath} onSelect={selectFile} />
      <SidebarResizer storageKey="sourceExplorerWidth" label="Resize Explorer" />
      <section className="source-pane">
        {notice && <p role="status" className="source-notice">{notice}</p>}
        {current?.editorTarget === null && <p className="source-notice">Viewing the reviewed version. The file on disk differs or has been removed.</p>}
        {current ? <SourceCode file={current} onFollow={follow} line={atDefinition ? line : undefined} /> :
          <p role="status" className="source-notice">{otherFile?.error || "Loading source…"}</p>}
      </section>
    </div> : <p role="status" className="source-notice">{definition?.error || "Locating definition…"}</p>}
  </BriefDialog>;
}
