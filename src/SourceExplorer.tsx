import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import type { ChangedFile } from "./types";

type Mark = "A" | "D" | "M";
type Change = { mark: Mark; label: string; side?: "new" | "old" };
export type Reveal = { path: string; folder: boolean };

export function explorerChanges(files: ChangedFile[]) {
  const changes = new Map<string, Change>();
  for (const file of files) {
    if (file.status === "R" && file.oldPath)
      changes.set(file.oldPath, { mark: "D", label: "Renamed to " + file.path, side: "old" });
  }
  for (const file of files) {
    if (["A", "?", "R", "C"].includes(file.status)) {
      const label = file.oldPath ? (file.status === "C" ? "Copied from " : "Renamed from ") + file.oldPath : "Added";
      changes.set(file.path, { mark: "A", label, side: "new" });
    } else if (file.status === "D") {
      changes.set(file.path, { mark: "D", label: "Deleted", side: "old" });
    } else {
      changes.set(file.path, { mark: "M", label: "Modified" });
    }
  }
  return changes;
}

const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const ancestorsOf = (path: string) => {
  const folders: string[] = [];
  for (let dir = parent(path); dir; dir = parent(dir)) folders.push(dir);
  return folders;
};
const order = new Intl.Collator(undefined, { numeric: true });
const installed = (path: string) => path.split("/").includes("node_modules");

type Item = { path: string; name: string; folder: boolean };
function folderIndex(files: Iterable<string>) {
  const folders = new Map<string, Item[]>([["", []]]);
  function insert(path: string, folder: boolean) {
    const dir = parent(path);
    if (!folders.has(dir)) {
      insert(dir, true);
      folders.set(dir, []);
    }
    folders.get(dir)!.push({ path, folder, name: path.slice(path.lastIndexOf("/") + 1) });
  }
  for (const path of files) insert(path, false);
  for (const entries of folders.values())
    entries.sort((a, b) => Number(b.folder) - Number(a.folder) || order.compare(a.name, b.name));
  return folders;
}

export function folderChanges(changes: Map<string, Change>) {
  const folders = new Map<string, Record<Mark, number>>();
  for (const [path, change] of changes) {
    for (const dir of ancestorsOf(path)) {
      const counts = folders.get(dir) ?? { A: 0, M: 0, D: 0 };
      counts[change.mark]++;
      folders.set(dir, counts);
    }
  }
  return folders;
}
// Mixed changes read as modified, the way an editor colors a folder.
export const folderMark = (counts: Record<Mark, number>): Mark =>
  counts.M || (counts.A && counts.D) ? "M" : counts.A ? "A" : "D";
const describe = (counts: Record<Mark, number>) => {
  const total = counts.A + counts.M + counts.D;
  const kinds = ([["M", "modified"], ["A", "added"], ["D", "deleted"]] as const)
    .filter(([mark]) => counts[mark]).map(([mark, word]) => counts[mark] + " " + word);
  return `${total} changed file${total === 1 ? "" : "s"}: ${kinds.join(", ")}`;
};

type Scroll = { path?: string; block?: "center" | "start"; focus?: boolean; top?: number };

// Children commit before the dialog around them opens, so measure once the element has a size.
export function whenLaidOut(element: HTMLElement, run: () => void) {
  if (element.clientHeight) {
    run();
    return;
  }
  const observer = new ResizeObserver(() => {
    if (!element.clientHeight) return;
    observer.disconnect();
    run();
  });
  observer.observe(element);
  return () => observer.disconnect();
}

// A folder row may be stuck to the top, so its branch gives its real position. A file row's parent
// is its folder's branch.
export const rowTop = (view: HTMLElement, row: HTMLElement) =>
  (row.hasAttribute("aria-expanded") ? row.parentElement! : row).getBoundingClientRect().top
    - view.getBoundingClientRect().top + view.scrollTop;

// The deepest pinned folder draws the shadow, so only the bottom of the pinned stack has one.
function markStuck(view: HTMLElement) {
  let deepest: HTMLElement | undefined;
  for (const row of view.querySelectorAll<HTMLElement>('.tree-branch > [aria-expanded="true"]')) {
    const branch = row.parentElement!;
    const slot = view.scrollTop + (Number(row.getAttribute("aria-level")) - 1) * row.offsetHeight;
    if (branch.offsetTop < slot && branch.offsetTop + branch.offsetHeight > slot) deepest = row;
  }
  for (const row of view.querySelectorAll<HTMLElement>("[data-stuck]")) if (row !== deepest) delete row.dataset.stuck;
  if (deepest) deepest.dataset.stuck = "";
}

export function SourceExplorer({ paths, changes, file, reveal, onSelect }: {
  paths: string[]; changes: Map<string, Change>; file: string; reveal?: Reveal; onSelect: (path: string) => void;
}) {
  const index = useMemo(() => folderIndex(new Set([...paths, ...changes.keys()])), [paths, changes]);
  const summaries = useMemo(() => folderChanges(changes), [changes]);
  const ancestors = useMemo(() => new Set(ancestorsOf(file)), [file]);
  const [expanded, setExpanded] = useState(() => new Set(ancestors));
  const [active, setActive] = useState("file:" + file);
  const [scroll, setScroll] = useState<Scroll | null>({ path: file, block: "center" });
  const [shown, setShown] = useState({ file, reveal });
  const tree = useRef<HTMLDivElement>(null);
  const open = (folders: Iterable<string>) => setExpanded(previous => {
    const next = new Set(previous);
    for (const folder of folders) next.add(folder);
    return next.size === previous.size ? previous : next;
  });
  if (shown.file !== file || shown.reveal !== reveal) {
    setShown({ file, reveal });
    if (shown.file !== file) {
      open(ancestors);
      setActive("file:" + file);
      setScroll({ path: file, block: "center" });
    }
    if (reveal && shown.reveal !== reveal) {
      open(reveal.folder ? [...ancestorsOf(reveal.path), reveal.path] : ancestorsOf(reveal.path));
      setScroll({ path: reveal.path, block: reveal.folder ? "start" : "center", focus: true });
    }
  }

  useLayoutEffect(() => {
    const view = tree.current;
    if (!scroll || !view) return;
    return whenLaidOut(view, () => {
      if (scroll.top !== undefined) {
        view.scrollTop = scroll.top;
        return;
      }
      const row = view.querySelector<HTMLElement>(`[data-path="${CSS.escape(scroll.path!)}"]`);
      if (!row) return;
      const rowHeight = row.offsetHeight;
      const top = rowTop(view, row);
      const covered = (Number(row.getAttribute("aria-level")) - 1) * rowHeight;
      if (scroll.block === "start") view.scrollTop = top - covered;
      else if (top < view.scrollTop + covered || top + rowHeight > view.scrollTop + view.clientHeight)
        view.scrollTop = top - (view.clientHeight - rowHeight) / 2;
      if (scroll.focus) row.focus({ preventScroll: true });
    });
  }, [scroll]);
  useLayoutEffect(() => markStuck(tree.current!));

  function toggle(path: string, row: HTMLElement) {
    const view = tree.current!;
    if (!expanded.has(path)) {
      open([path]);
      if (ancestors.has(path)) setScroll({ path: file, block: "center" });
      return;
    }
    setExpanded(previous => {
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
    // Collapsing a folder pinned at the top would otherwise leave the reader far below it.
    const slot = rowTop(view, row) - (Number(row.getAttribute("aria-level")) - 1) * row.offsetHeight;
    if (view.scrollTop > slot) setScroll({ top: slot });
  }

  const rows = (dir: string, level: number): React.ReactNode => index.get(dir)?.map((item, i, siblings) => {
    const { path, name, folder } = item;
    const id = (folder ? "folder:" : "file:") + path;
    const isOpen = folder && expanded.has(path);
    const change = folder ? undefined : changes.get(path);
    const counts = folder ? summaries.get(path) : undefined;
    const total = counts ? counts.A + counts.M + counts.D : 0;
    const holdsFile = folder && ancestors.has(path);
    const detail = change ? change.label : counts ? describe(counts) : "";
    const Icon = folder ? (isOpen ? FolderOpen : Folder) : File;
    const row = <button role="treeitem" type="button" className="tree-row" data-path={path}
      data-change={change?.mark ?? (counts && folderMark(counts))}
      data-holds-file={holdsFile || undefined} data-installed={installed(path) || undefined}
      aria-level={level} aria-setsize={siblings.length} aria-posinset={i + 1}
      aria-expanded={folder ? isOpen : undefined} aria-selected={!folder && path === file}
      aria-label={name + (detail ? ", " + detail : "") + (holdsFile && !isOpen ? ", contains the open file" : "")}
      title={detail ? path + " · " + detail : path}
      tabIndex={active === id ? 0 : -1} onFocus={() => setActive(id)}
      style={{ "--level": level } as React.CSSProperties}
      onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        if (folder) toggle(path, event.currentTarget);
        else onSelect(path);
      }}>
      <span className="tree-twisty">{folder && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</span>
      <Icon size={15} className="tree-icon" />
      <span className="tree-name">{name}</span>
      {change ? <b className="tree-badge">{change.mark}</b> : total ? <b className="tree-badge">{total}</b> : null}
    </button>;
    // Folders keep their wrapper while collapsed, so toggling never remounts the focused row.
    return folder
      ? <div key={id} className="tree-branch" style={{ "--level": level } as React.CSSProperties}>
          {row}{isOpen && rows(path, level + 1)}
        </div>
      : <React.Fragment key={id}>{row}</React.Fragment>;
  });

  return <aside className="source-explorer" id="worktree-explorer" aria-label="Explorer">
    <div ref={tree} role="tree" aria-label="Worktree files" onScroll={event => markStuck(event.currentTarget)} onKeyDown={event => {
      const row = event.target;
      if (!(row instanceof HTMLButtonElement)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')];
      const i = items.indexOf(row);
      const state = row.getAttribute("aria-expanded");
      let next: HTMLButtonElement | undefined;
      switch (event.key) {
        case "ArrowDown": next = items[i + 1]; break;
        case "ArrowUp": next = items[i - 1]; break;
        case "Home": next = items[0]; break;
        case "End": next = items.at(-1); break;
        case "ArrowRight":
          if (state === "false") toggle(row.dataset.path!, row);
          else if (state === "true") next = items[i + 1];
          break;
        case "ArrowLeft":
          if (state === "true") toggle(row.dataset.path!, row);
          else next = items.find(item => item.hasAttribute("aria-expanded") && item.dataset.path === parent(row.dataset.path!));
          break;
        default: return;
      }
      event.preventDefault();
      next?.focus();
    }}>{rows("", 1)}</div>
  </aside>;
}
