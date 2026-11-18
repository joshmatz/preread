import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import type { ChangedFile } from "./types";

type Change = { mark: "A" | "D" | "M"; label: string; side?: "new" | "old" };
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

type Item = { path: string; name: string; folder: boolean };
const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const reveal = (button: HTMLButtonElement | null) => button?.scrollIntoView({ block: "nearest" });
const order = new Intl.Collator(undefined, { numeric: true });

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

export function SourceExplorer({ paths, changes, file, onSelect }: {
  paths: string[]; changes: Map<string, Change>; file: string; onSelect: (path: string) => void;
}) {
  const index = useMemo(() => folderIndex(new Set([...paths, ...changes.keys()])), [paths, changes]);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [active, setActive] = useState("file:" + file);
  const tree = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    setExpanded(previous => {
      const ancestors = new Set(previous);
      for (let path = parent(file); path; path = parent(path)) ancestors.add(path);
      return ancestors.size === previous.size ? previous : ancestors;
    });
    setActive("file:" + file);
  }, [file]);
  const toggle = (path: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const rows = (dir: string, level: number): React.ReactNode => index.get(dir)?.map((item, i, siblings) => {
    const { path, name, folder } = item;
    const id = (folder ? "folder:" : "file:") + path;
    const open = folder && expanded.has(path);
    const change = folder ? undefined : changes.get(path);
    const Icon = folder ? (open ? FolderOpen : Folder) : File;
    return <React.Fragment key={id}>
      <button role="treeitem" type="button" data-path={path} data-change={change?.mark}
        ref={!folder && file === path ? reveal : undefined}
        aria-level={level} aria-setsize={siblings.length} aria-posinset={i + 1}
        aria-expanded={folder ? open : undefined} aria-selected={!folder && file === path}
        aria-label={change ? name + ", " + change.label : name} title={change ? path + " · " + change.label : path}
        tabIndex={active === id ? 0 : -1} onFocus={() => setActive(id)}
        style={{ paddingInlineStart: 8 + 14 * (level - 1) }}
        onClick={event => { event.currentTarget.focus(); folder ? toggle(path) : onSelect(path); }}>
        {folder ? (open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>) : <span className="tree-indent"/>}
        <Icon size={14}/><span className="tree-name">{name}</span>{change && <b>{change.mark}</b>}
      </button>
      {open && rows(path, level + 1)}
    </React.Fragment>;
  });

  return <aside className="source-explorer" id="worktree-explorer">
    <h3>Explorer</h3>
    <div ref={tree} role="tree" aria-label="Worktree files" onKeyDown={event => {
      const row = event.target;
      if (!(row instanceof HTMLButtonElement)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')];
      const i = items.indexOf(row);
      const expanded = row.getAttribute("aria-expanded");
      let next: HTMLButtonElement | undefined;
      switch (event.key) {
        case "ArrowDown": next = items[i + 1]; break;
        case "ArrowUp": next = items[i - 1]; break;
        case "Home": next = items[0]; break;
        case "End": next = items.at(-1); break;
        case "ArrowRight":
          if (expanded === "false") toggle(row.dataset.path!);
          else if (expanded === "true") next = items[i + 1];
          break;
        case "ArrowLeft":
          if (expanded === "true") toggle(row.dataset.path!);
          else next = items.find(item => item.hasAttribute("aria-expanded") && item.dataset.path === parent(row.dataset.path!));
          break;
        default: return;
      }
      event.preventDefault();
      next?.focus();
    }}>{rows("", 1)}</div>
  </aside>;
}
