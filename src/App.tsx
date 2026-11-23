import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FileCode2,
  Film,
  FlaskConical,
  FoldVertical,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  ImageIcon,
  Layers3,
  LoaderCircle,
  Lock,
  Maximize2,
  MessageSquarePlus,
  MessageSquareReply,
  Music,
  Palette,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  Sheet,
  SquareTerminal,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import "diff2html/bundles/css/diff2html.min.css";
import type { Diff, Mode, Repository, StackNode } from "./types";
import type { Collection, FilePreview, ProgressSource, Review, ReviewSection, ReviewSnapshot, SinceViewed } from "./review-types";
import { displayedLines, displayedPatch } from "./whitespace-diff";
import { useFileState, useFileStateVersion, fileViewed, setFilesCollapsed } from "./useFileState";
import { useNote } from "./notes";
import { anchorLine, cardKey, clipLine, commentCard, lineKey, patchLines, placeComments, type CodeComment, type CodeCommentCommand, type CodeJump, type CodeLine } from "./code-comments";
import { openThreads, threadCounts, threadState, type Threads } from "./threads";
import { loadDrafts, saveDrafts } from "./code-drafts";
import { editKey, FileComments, LineThread, UnplacedComments, type CodeDraft, type CommentActions } from "./CodeComments";
import { groupTitleIn } from "./brief-feedback";
import { useCodeComments } from "./useCodeComments";
import { Picker } from "./Picker";
import { ReviewVisuals } from "./ReviewVisuals";
import { OutlineGroup } from "./OutlineGroup";
import { OutlineFolder } from "./OutlineFolder";
import { HoverCards, useHoverCard, WrappablePath } from "./HoverCard";
import { ChangeMeter } from "./ChangeMeter";
import { byFolder } from "./outline-folders";
import { SidebarResizer } from "./SidebarResizer";
import { Popover } from "./Popover";
import { fileKind, fileKindLabels, isTestFile, type FileKind } from "./file-kinds";
import { displaySections } from "./review-display";
import { diffChunks } from "./diff-chunks";
import { useReviewSearch } from "./useReviewSearch";
import { searchLines } from "./review-search";
import type { SearchScope, SearchMatch } from "./review-search";
import { diffSize } from "./diff-size";
import { scrollToChange } from "./scroll-to-change";
import { onScreen, reached, useScrollPlace } from "./scroll-place";
import { noContentNote, pathDiff, reviewable, type PathPart } from "./change-notes";
import { useCollectionProgress } from "./useCollectionProgress";
import { codeGroups, collectionProgress, markedFile, progressLabel, progressSource, unviewedGroups, withFileViews } from "./progress";
import { PullRequest, PullRequestLine } from "./PullRequest";
import { LineCounts } from "./LineCounts";
import { ImageDiff } from "./ImageDiff";
import { BrandMark } from "./BrandMark";
import { usePullRequests } from "./usePullRequests";
import { FeatureBrief } from "./FeatureBrief";
import { GroupBar, GroupReviewButton } from "./GroupBar";
import { BriefTabs } from "./BriefTabs";
import { useBrief } from "./useBrief";
import { Markdown, plainText } from "./Markdown";
import type { FeatureBrief as BriefDocument } from "./brief-types";
import { groupTitle, type MarkTargets } from "./BriefCodeGroups";
import { BriefContents, headingCounts, type ContentsGroup } from "./BriefContents";
import { groupReadState } from "./BriefGroupStatus";
import { ReviewFrame, type Drawer } from "./ReviewFrame";
import { partTree } from "./part-tree";
import { Description } from "./Description";
import { briefStructure } from "./brief-outline";
import {
  createContextModel,
  contextGaps,
  initialGaps,
  gapControls,
  expandContext,
  contextPatch,
  firstChange,
  type ContextModel,
} from "./diff-context";
import { DefinitionDialog, definitionButtons, useDefinitionModifier, definitionModifier, lookupDefinition, openSourceFile, type Definition, type Side } from "./DefinitionDialog";
import { diffRows, drawDiff, insertedRows, rowAt } from "./draw-diff";
import "./style.css";

const params = new URLSearchParams(location.search);
type Origin = { collection: string; review?: string; view?: "feedback" };
type PageState = { origin?: Origin; group?: CodeJump; view?: "feedback" };
const pageState = (): PageState => (history.state as { preread?: PageState } | null)?.preread ?? {};
const load = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Browsing stays available when browser storage is disabled. */
  }
};
async function request<T>(
  route: string,
  values: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${route}?${new URLSearchParams(values)}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not read the local review.");
  return data;
}
async function mutate<T>(route: string, body: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save this review.");
  return data;
}
const modeLabels: Record<Mode, string> = {
  branch: "Branch commits",
  all: "Branch + local edits",
  working: "Uncommitted changes",
  staged: "Staged changes",
};
const modeHelp: Record<Mode, string> = {
  branch: "Commits since the branch left the base",
  all: "Those commits plus staged, unstaged, and untracked files",
  working: "Staged, unstaged, and untracked files compared with HEAD",
  staged: "The index compared with HEAD",
};
const comparesWithHead = (mode: Mode) => mode === "working" || mode === "staged";
const comparisonSummary = (mode: Mode, base: string) => {
  const named = /^[0-9a-f]{7,40}$/i.test(base) ? "" : base;
  if (comparesWithHead(mode)) return modeLabels[mode];
  if (mode === "all") return named ? `Since ${named}, with local edits` : modeLabels.all;
  return named ? `Since ${named}` : modeLabels.branch;
};
const statusNames: Record<string, string> = {
  A: "Added",
  C: "Copied",
  D: "Deleted",
  M: "Modified",
  R: "Renamed",
  T: "Type changed",
  U: "Unmerged",
  "?": "Untracked",
};
// Untracked files take U, as in editors, so git's U for unmerged becomes !.
const statusLetters: Record<string, string> = { "?": "U", U: "!" };
const kindIcons: Record<FileKind, LucideIcon> = {
  code: FileCode2,
  test: FlaskConical,
  styles: Palette,
  docs: BookOpen,
  config: Settings2,
  data: Braces,
  table: Sheet,
  database: Database,
  script: SquareTerminal,
  lockfile: Lock,
  image: ImageIcon,
  font: Type,
  video: Film,
  audio: Music,
  archive: Archive,
};
const filename = (path: string) => path.split("/").at(-1)!;
const short = (branch: string) => branch.replace(/^(codex|feat|fix)\//, "");
const anchor = (section: string, path = "") => `change-${encodeURIComponent(`${section}:${path}`)}`;
const Loading = ({ children }: { children: React.ReactNode }) => (
  <div className="loading" role="status">
    <LoaderCircle size={17} className="spin" />
    {children}
  </div>
);
type Theme = "system" | "light" | "dark";
function useTheme() {
  const [theme, setTheme] = useState<Theme>(load("theme", "system"));
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    save("theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme] as const;
}
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, React.ReactNode][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
function ComparisonForm({
  repo,
  base,
  mode,
  inCollection,
  untracked,
  onCompare,
}: {
  repo: Repository;
  base: string;
  mode: Mode;
  inCollection: boolean;
  untracked: boolean;
  onCompare: (base: string, mode: Mode) => void;
}) {
  const [baseDraft, setBaseDraft] = useState(base || repo.defaultBase);
  const [modeDraft, setModeDraft] = useState(mode);
  return (
    <form
      className="comparison-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCompare(
          comparesWithHead(modeDraft) ? base : baseDraft.trim() || repo.defaultBase,
          modeDraft,
        );
      }}
    >
      <p className="comparison-where">
        <strong>{repo.name}</strong>
        {repo.path.split(/(?=\/)/).map((part, index) => (
          <span key={index}>{part}</span>
        ))}
      </p>
      <fieldset>
        <legend>Show</legend>
        {(Object.keys(modeLabels) as Mode[]).map((value) => (
          <label className="mode-option" key={value}>
            <input
              type="radio"
              name="comparison-mode"
              checked={modeDraft === value}
              onChange={() => setModeDraft(value)}
            />
            <span>
              {modeLabels[value]}
              <small>{modeHelp[value]}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="base-field">
        Base branch or commit
        <input
          list="branches"
          value={baseDraft}
          onChange={(event) => setBaseDraft(event.target.value)}
          disabled={comparesWithHead(modeDraft)}
          autoComplete="off"
          data-1p-ignore
        />
        <datalist id="branches">
          {repo.refs.map((ref) => (
            <option key={ref} value={ref} />
          ))}
        </datalist>
      </label>
      {untracked && <p className="muted">Line counts leave out untracked files.</p>}
      {inCollection && (
        <p className="muted">A different comparison opens outside this collection.</p>
      )}
      <button className="primary" type="submit">
        Compare
      </button>
    </form>
  );
}
type Live = { instance: string; refresh: number; reload: number };
type ContextSource = { path: string; base: string; mode: Mode; version: string };
// Gap rows gain buttons once context loads and can wrap onto a second line.
const gapRowsAbove = (element: HTMLElement, gap: number) => {
  let height = 0;
  const body = element.querySelector(".d2h-diff-tbody");
  for (const controls of body?.querySelectorAll<HTMLElement>(".context-controls") ?? [])
    if (Number(controls.dataset.gap) < gap) height += controls.getBoundingClientRect().height;
  return height;
};
type DiffComments = {
  threads: string[];
  render: (key: string) => React.ReactNode;
  onAdd?: (line: CodeLine) => void;
  newOnly?: boolean;
  onLines?: (view: string, lines: ReadonlyMap<string, string> | null) => void;
};
type PlacedThread = { row: HTMLTableRowElement; spacer?: HTMLTableRowElement; mount: HTMLDivElement; observer?: ResizeObserver };
const afterInserted = (row: Element) => {
  let last = row;
  while (last.nextElementSibling?.matches(insertedRows)) last = last.nextElementSibling;
  return last;
};
function DiffView({
  preview,
  eager,
  split,
  wrap,
  ignoreWhitespace,
  source,
  context,
  onContextChange,
  loadContext,
  expandable = true,
  searchMatch,
  onSearchReady,
  chunkIndex,
  comments,
}: {
  chunkIndex?: number;
  comments?: DiffComments;
  expandable?: boolean;
  loadContext?: (signal: AbortSignal) => Promise<Diff>;
  searchMatch?: { match: SearchMatch; version: number };
  onSearchReady?: (row: HTMLElement) => void;
  preview: FilePreview;
  eager: boolean;
  split: boolean;
  wrap: boolean;
  ignoreWhitespace: boolean;
  source: ContextSource;
  context: ContextModel | null;
  onContextChange: (context: ContextModel) => void;
}) {
  const [definition, setDefinition] = useState<{ side: Side; data: Definition; id: number } | null>(null);
  const [contextStatus, setContextStatus] = useState<{ gap: number; error?: string } | null>(
    null,
  );
  const contextBusy = !!contextStatus && !contextStatus.error;
  const abort = useRef(new AbortController());
  const focusGap = useRef<number | null>(null);
  const handledMatch = useRef<number | null>(null);
  const rowsAbove = useRef<{ gap: number; height: number } | null>(null);
  const completePatch = context ? contextPatch(context) : preview.diff.patch;
  const size = useMemo(() => diffSize(preview.diff.patch), [preview.diff.patch]);
  const chunks = useMemo(() => chunkIndex === undefined ? diffChunks(completePatch) : [completePatch], [completePatch, chunkIndex]);
  const patch = completePatch;
  const note = noContentNote(preview.diff.patch);
  let message = "";
  if (preview.error) message = preview.error;
  else if (preview.diff.tooLarge)
    message =
      "This diff is too large to preview. Open the file locally or choose a closer comparison base.";
  else if (note) message = note;
  else if (preview.diff.binary)
    message = "Binary file changed. Open the file locally to inspect it, then mark it Viewed.";
  else if (preview.diff.empty)
    message = "No text changes. This file may be empty or have a mode change.";
  const drawsRows = chunks.length === 1;
  // The drawing and the comment anchors read one result: whitespace matching can time out, so two runs may differ.
  const shownCache = useRef<{ patch: string; ignoreWhitespace: boolean; value: ReturnType<typeof displayedPatch> } | null>(null);
  const shown = () => {
    const cached = shownCache.current;
    if (cached?.patch === patch && cached.ignoreWhitespace === ignoreWhitespace) return cached.value;
    const value = displayedPatch(patch, ignoreWhitespace);
    shownCache.current = { patch, ignoreWhitespace, value };
    return value;
  };
  const newOnly = !!comments?.newOnly;
  const reportLines = comments?.onLines;
  const lines = useMemo(() => {
    if (!reportLines || !drawsRows) return null;
    const all = message ? new Map<string, string>() : displayedLines(shown());
    // Since viewed, the old side is the last viewed text, not the base the comments were written against.
    if (newOnly) for (const key of [...all.keys()]) if (key.startsWith("old:")) all.delete(key);
    return all;
  }, [patch, ignoreWhitespace, !!reportLines, drawsRows, !!message, newOnly]);
  const lineView = chunkIndex === undefined ? "file" : `chunk:${chunkIndex}`;
  // Before paint, so a comment saved on a shown line never flashes into the file's list first.
  useLayoutEffect(() => {
    if (!reportLines || !lines) return;
    reportLines(lineView, lines);
    return () => reportLines(lineView, null);
  }, [lines, reportLines, lineView]);
  const placed = useRef(new Map<string, PlacedThread>());
  const [mounts, setMounts] = useState<ReadonlyMap<string, HTMLDivElement>>(() => new Map());
  const threadKey = comments?.threads.join("|") ?? "";
  const publishMounts = () => setMounts(new Map([...placed.current].map(([key, entry]) => [key, entry.mount])));
  const clearThreads = () => {
    for (const entry of placed.current.values()) entry.observer?.disconnect();
    if (!placed.current.size) return;
    placed.current.clear();
    publishMounts();
  };
  const syncThreads = (element: HTMLElement) => {
    const wanted = new Set(comments?.threads);
    let changed = false;
    for (const [key, entry] of placed.current) {
      if (wanted.has(key) && element.contains(entry.row)) continue;
      entry.row.remove();
      entry.spacer?.remove();
      entry.observer?.disconnect();
      placed.current.delete(key);
      changed = true;
    }
    const rows = wanted.size ? diffRows(element, split) : null;
    for (const key of wanted) {
      const anchor = rows?.byKey.get(key);
      if (placed.current.has(key) || !anchor) continue;
      const row = document.createElement("tr");
      row.className = "line-comment-row";
      row.dataset.line = key;
      const gutter = document.createElement("td");
      gutter.className = "line-comment-gutter";
      const cell = document.createElement("td");
      cell.className = "line-comment-cell";
      const mount = document.createElement("div");
      mount.className = "line-comment-mount";
      cell.append(mount);
      row.append(gutter, cell);
      afterInserted(anchor.row).after(row);
      const entry: PlacedThread = { row, mount };
      const partner = split ? rows!.sides[anchor.side ^ 1]?.[anchor.index] : undefined;
      if (partner) {
        const spacer = document.createElement("tr");
        spacer.className = "line-comment-spacer";
        const fill = document.createElement("td");
        fill.colSpan = 2;
        spacer.append(fill);
        afterInserted(partner).after(spacer);
        entry.spacer = spacer;
        entry.observer = new ResizeObserver(() => { fill.style.height = `${row.getBoundingClientRect().height}px`; });
        entry.observer.observe(mount);
      }
      placed.current.set(key, entry);
      changed = true;
    }
    if (changed) publishMounts();
  };
  const addComment = (event: React.MouseEvent<HTMLDivElement>) => {
    const element = target.current;
    const cell = event.target instanceof Element
      ? event.target.closest("td.d2h-code-linenumber, td.d2h-code-side-linenumber") : null;
    if (!element || !cell || !comments?.onAdd || !element.contains(cell)) return;
    const key = diffRows(element, split).keyOf(cell);
    if (!key || (newOnly && key.startsWith("old:"))) return;
    const text = (lines ?? displayedLines(shown())).get(key);
    if (text === undefined) return;
    const [side, number] = key.split(":");
    comments.onAdd({ side: side as CodeLine["side"], number: Number(number), text: clipLine(text) });
  };
  const reveal = async (gap: number, direction: "above" | "below" | "all") => {
    if (contextBusy) return;
    const { signal } = abort.current;
    setContextStatus({ gap });
    focusGap.current = gap;
    try {
      let model = context;
      if (!model) {
        const expanded = await (loadContext ? loadContext(signal) : request<Diff>(
          "context",
          { ...source, file: preview.file.path, hash: preview.contextHash ?? preview.diff.hash },
          signal,
        ));
        model = createContextModel(preview.diff.patch, expanded.patch);
      }
      if (!signal.aborted) {
        rowsAbove.current = { gap, height: gapRowsAbove(target.current!, gap) };
        onContextChange(expandContext(model, gap, direction));
        setContextStatus(null);
      }
    } catch (cause) {
      if (!signal.aborted) setContextStatus({ gap, error: (cause as Error).message });
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    focusGap.current = null;
    setContextStatus(null);
    return () => controller.abort();
  }, [source.version, preview.diff.hash]);
  useEffect(() => {
    if (!searchMatch) return;
    setVisible(true);
  }, [searchMatch, preview.diff.hash]);
  const target = useRef<HTMLDivElement>(null);
  const [retainedHeight, setRetainedHeight] = useState(() => chunkIndex === undefined ? 180 : Math.max(180, (size.lines + 1) * 22.2));
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (!target.current) return;
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    }, { rootMargin: "300px" });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [chunks.length]);
  useEffect(() => {
    if (!visible || !target.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height > 0) setRetainedHeight(entry.contentRect.height);
    });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [visible, chunks.length]);
  useEffect(() => {
    const element = target.current;
    if (!element || !visible || !patch || preview.error) return;
    drawDiff(element, shown(), {
      split,
      ignoreWhitespace,
      matching: chunkIndex !== undefined || size.deferred ? "none" : "lines",
      decorate: !loadContext && /\.[cm]?[jt]sx?$/i.test(preview.file.path) ? definitionButtons : undefined,
    });
    // A type change diffs as a deletion plus an addition, which share no context.
    const gaps =
      !expandable || preview.file.status === "T" ? [] : context ? contextGaps(context) : initialGaps(patch);
    // A "Show more below" that finds no more lines becomes "End of file" rather than vanishing.
    const offeredMore = !!initialGaps(preview.diff.patch).at(-1)?.below;
    for (const body of element.querySelectorAll(".d2h-diff-tbody")) {
      // Split view has an empty matching hunk header on the right.
      const headings = [...body.querySelectorAll("tr")].filter((row) =>
        row.querySelector("td.d2h-info"),
      );
      gaps.forEach((gap, index) => {
        const empty = !gap.above && !gap.below && !gap.otherChanges;
        const endOfFile = empty && offeredMore && !!context && index === gaps.length - 1;
        if (empty && !endOfFile) return;
        const row = document.createElement("tr");
        row.className = "context-row";
        const gutter = document.createElement("td");
        gutter.className = split
          ? "d2h-code-side-linenumber d2h-info"
          : "d2h-code-linenumber d2h-info";
        const cell = document.createElement("td");
        const controls = document.createElement("div");
        controls.className = "context-controls";
        controls.dataset.gap = String(index);
        const button = (label: string, direction: "above" | "below" | "all") => {
          const control = document.createElement("button");
          control.type = "button";
          control.textContent = label;
          control.addEventListener("click", () => void reveal(index, direction));
          controls.append(control);
        };
        const note = (text: string) => {
          const span = document.createElement("span");
          span.textContent = text;
          controls.append(span);
          return span;
        };
        for (const { label, direction } of gapControls(gap, !!context, index === gaps.length - 1))
          button(label, direction);
        if (gap.otherChanges) note("Other changed blocks belong to another group");
        if (endOfFile) note("End of file");
        const status = note("");
        status.className = "context-message";
        status.setAttribute("role", "status");
        cell.append(controls);
        row.append(gutter, cell);
        if (headings[index]) headings[index].before(row);
        else body.append(row);
      });
    }
    if (rowsAbove.current) {
      scrollBy(0, gapRowsAbove(element, rowsAbove.current.gap) - rowsAbove.current.height);
      rowsAbove.current = null;
    }
    if (focusGap.current !== null) {
      const controls = [
        ...element.querySelectorAll<HTMLButtonElement>(
          `.context-controls[data-gap="${focusGap.current}"] button`,
        ),
      ];
      (controls[0] ?? element.querySelector<HTMLButtonElement>(".context-controls button"))?.focus({
        preventScroll: true,
      });
      focusGap.current = null;
    }
    if (searchMatch && (chunkIndex ?? 0) === searchMatch.match.chunk) {
      const row = rowAt(element, split, searchMatch.match.side, searchMatch.match.line);
      if (row) {
        row.classList.add("search-hit");
        if (handledMatch.current !== searchMatch.version) {
          handledMatch.current = searchMatch.version;
          onSearchReady?.(row);
        }
      }
    }
    syncThreads(element);
    setRetainedHeight(Math.max(180, element.getBoundingClientRect().height));
    return () => {
      element.innerHTML = "";
      clearThreads();
    };
  }, [patch, split, visible, context, ignoreWhitespace, expandable, chunkIndex, searchMatch, onSearchReady]);
  useEffect(() => {
    if (target.current && visible) syncThreads(target.current);
  }, [threadKey, visible]);
  useEffect(() => {
    const element = target.current;
    if (!element || !visible || !split || !wrap) return;
    const sides = [...element.querySelectorAll(".d2h-file-side-diff")];
    if (sides.length !== 2) return;
    const [left, right] = sides.map((side) => [
      ...side.querySelectorAll<HTMLTableRowElement>("tbody > tr"),
    ].filter((row) => !row.matches(insertedRows)));
    let previousWidth = -1;
    const alignRows = () => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      for (const row of [...left, ...right]) row.style.height = "";
      const heights = left.map((row, index) =>
        Math.max(
          row.getBoundingClientRect().height,
          right[index]?.getBoundingClientRect().height ?? 0,
        ),
      );
      left.forEach((row, index) => {
        row.style.height = `${heights[index]}px`;
        if (right[index]) right[index].style.height = `${heights[index]}px`;
      });
    };
    // Split diffs use independent tables, so wrapped rows need matching heights.
    alignRows();
    const observer = new ResizeObserver(alignRows);
    observer.observe(element);
    return () => {
      observer.disconnect();
      for (const row of [...left, ...right]) row.style.height = "";
    };
  }, [patch, split, visible, wrap, context, ignoreWhitespace]);
  useEffect(() => {
    for (const controls of target.current?.querySelectorAll<HTMLElement>(".context-controls") ??
      []) {
      for (const control of controls.querySelectorAll("button")) control.disabled = contextBusy;
      const status = controls.querySelector(".context-message")!;
      const current = contextStatus?.gap === Number(controls.dataset.gap);
      status.textContent = current ? (contextStatus.error ?? "Loading…") : "";
      status.classList.toggle("failed", current && !!contextStatus.error);
    }
  }, [contextStatus, patch]);
  const commentable = comments?.onAdd ? (comments.newOnly ? " commentable new-only" : " commentable") : "";
  return (
    <div className="diff-body">
      {message ? (
        <p className="empty-file">{message}</p>
      ) : chunks.length > 1 ? (
        chunks.map((chunk, index) => <DiffView key={`${preview.diff.hash}:${index}`}
          preview={{ ...preview, diff: { ...preview.diff, patch: chunk } }}
          chunkIndex={index} eager={eager && index === 0} split={split} wrap={wrap}
          ignoreWhitespace={ignoreWhitespace} source={source} context={null}
          onContextChange={onContextChange} loadContext={loadContext} expandable={false}
          searchMatch={searchMatch?.match.chunk === index ? searchMatch : undefined}
          onSearchReady={onSearchReady} comments={comments} />)
      ) : (
        <div className={`diff-renderer ${visible ? "" : "deferred"}${commentable}`} ref={target}
          style={!visible ? { height: retainedHeight } : undefined} onClick={event => {
            const button = event.target instanceof Element && event.target.closest<HTMLButtonElement>(".definition-call");
            if (!button) { addComment(event); return; }
            if (event.detail !== 0 && !definitionModifier(event)) return;
            const key = diffRows(event.currentTarget, split).keyOf(button);
            if (!key) return;
            const [side, line] = key.split(":");
            const file = side === "old" ? preview.file.oldPath ?? preview.file.path : preview.file.path;
            const params = new URLSearchParams({ ...source, file, side, line, column: button.dataset.column!, name: button.textContent! });
            void lookupDefinition(params, button).then(data =>
              data && setDefinition({ side: side as Side, data, id: Date.now() }));
          }}
          tabIndex={-1} aria-label={`Diff for ${preview.file.path}${chunkIndex === undefined ? "" : `, section ${chunkIndex + 1}`}`} />
      )}
      {definition && <DefinitionDialog key={definition.id} source={source} side={definition.side} initial={definition.data}
        split={split} wrap={wrap} ignoreWhitespace={ignoreWhitespace} onClose={() => setDefinition(null)} />}
      {comments && [...mounts].map(([key, mount]) => createPortal(comments.render(key), mount, key))}
    </div>
  );
}
function RenamedPath({ from, to }: { from: string; to: string }) {
  const { before, after } = pathDiff(from, to);
  const marked = (parts: PathPart[], Mark: "del" | "ins") =>
    parts.map((part, index) => (part.changed ? <Mark key={index}>{part.text}</Mark> : part.text));
  return (
    <strong className="renamed-path">
      <span className="old-path">{marked(before, "del")}</span> <ArrowRight size={12} />{" "}
      {marked(after, "ins")}
    </strong>
  );
}
type ViewedSource = ContextSource & { collection?: string; review?: string };
function SinceViewedFile({ preview, section, source, split, wrap, ignoreWhitespace, context,
  onContextChange, onCompared, comments }: {
  comments?: DiffComments;
  preview: FilePreview;
  section: string;
  source: ViewedSource;
  split: boolean;
  wrap: boolean;
  ignoreWhitespace: boolean;
  context: ContextModel | null;
  onContextChange: (context: ContextModel) => void;
  onCompared: (hash: string) => void;
}) {
  const [result, setResult] = useState<SinceViewed | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const values = JSON.stringify({ ...source, group: section, file: preview.file.path,
    hash: preview.contextHash ?? preview.diff.hash, viewHash: preview.viewHash ?? preview.diff.hash });
  useEffect(() => {
    const abort = new AbortController();
    setResult(null);
    setError("");
    request<SinceViewed>("since-viewed", JSON.parse(values), abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setResult(result);
        onCompared(result.diff?.hash ?? "");
      })
      .catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [values, retry]);
  const loadContext = async (signal: AbortSignal) => {
    const full = await request<SinceViewed>("since-viewed", { ...JSON.parse(values), context: "full" }, signal);
    if (!full.diff) throw new Error(full.message);
    if (full.diff.tooLarge)
      throw new Error("This file is too large to expand here. Open it locally for the full context.");
    return full.diff;
  };
  if (error) return <p className="warning" role="alert">{error}{" "}
    <button onClick={() => setRetry((value) => value + 1)}>Retry comparison</button></p>;
  if (!result) return <Loading>Comparing with the last viewed version…</Loading>;
  if (!result.available) return <p className="empty-file">{result.message}</p>;
  return <>
    <p className="viewed-baseline">Since viewed on {new Date(result.reviewedAt!).toLocaleString()}
      {preview.partial ? " · Whole file, including changes outside this group’s selected blocks" : " · Whole file"}</p>
    {result.diff!.empty ? <p className="empty-file">No text changes since this file was viewed.</p> :
      <DiffView preview={{ ...preview, partial: false, diff: result.diff! }} eager={true}
        split={split} wrap={wrap} ignoreWhitespace={ignoreWhitespace} source={source}
        context={context} onContextChange={onContextChange} loadContext={loadContext} comments={comments} />}
  </>;
}
// The top bar and group bar cover a card down to where its toolbar sticks.
function topHidden(card: HTMLElement) {
  const style = getComputedStyle(card.querySelector(".file-toolbar")!);
  return card.getBoundingClientRect().top < (style.position === "sticky" ? parseFloat(style.top) : 0);
}
function FileCard({
  preview,
  eager,
  section,
  split,
  wrap,
  ignoreWhitespace,
  reviewed,
  defaultViewed,
  source,
  sinceViewed,
  onViewedSaved,
  onViewedAdvance,
  searchMatch,
  onSearchReady,
  comments,
}: {
  comments?: { list: CodeComment[]; threads: Threads; scope: string; saving: boolean; save: (command: CodeCommentCommand) => Promise<{ error?: string }> };
  preview: FilePreview;
  eager: boolean;
  section: string;
  split: boolean;
  wrap: boolean;
  ignoreWhitespace: boolean;
  reviewed: boolean;
  defaultViewed: boolean;
  source: ViewedSource;
  sinceViewed: boolean;
  onViewedSaved: (viewed: boolean) => void;
  onViewedAdvance: (current: HTMLElement) => void;
  searchMatch?: { match: SearchMatch; version: number };
  onSearchReady: (row: HTMLElement) => void;
}) {
  const size = useMemo(() => diffSize(preview.diff.patch), [preview.diff.patch]);
  const { viewed, collapsed, setCollapsed } = useFileState(
    source.path,
    markedFile(preview),
    defaultViewed,
    size.deferred,
  );
  const [viewSaving, setViewSaving] = useState(false);
  const [viewSaveError, setViewSaveError] = useState("");
  const viewKey = `${source.path}|${preview.viewHash ?? preview.diff.hash}`;
  const currentViewKey = useRef(viewKey);
  currentViewKey.current = viewKey;
  useEffect(() => { setViewSaveError(""); }, [viewKey]);
  const toggleViewed = async () => {
    const advance = !viewed && !!card.current && topHidden(card.current);
    setViewSaving(true);
    setViewSaveError("");
    try {
      await mutate<{ viewed: boolean }>("viewed-file", { ...source, group: section,
        file: preview.file.path, hash: preview.contextHash ?? preview.diff.hash,
        viewHash: preview.viewHash ?? preview.diff.hash, viewed: !viewed });
      if (currentViewKey.current === viewKey) {
        flushSync(() => {
          setCollapsed(!viewed);
          onViewedSaved(!viewed);
        });
        if (advance && card.current) onViewedAdvance(card.current);
      }
    } catch (cause) {
      if (currentViewKey.current === viewKey) setViewSaveError((cause as Error).message);
    } finally { setViewSaving(false); }
  };
  const bodyId = `${anchor(section, preview.file.path)}-body`;
  const [note, setNote] = useNote(`${source.path}|${preview.file.path}`);
  const draftCard = comments && source.collection && source.review ? `${source.collection}/${source.review}\n${section}\n${preview.file.path}` : "";
  const [drafts, setDrafts] = useState<Record<string, CodeDraft>>(() => draftCard ? loadDrafts(draftCard) : {});
  useEffect(() => { if (draftCard) saveDrafts(draftCard, drafts); }, [drafts, draftCard]);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [savingKey, setSavingKey] = useState("");
  const [lineMaps, setLineMaps] = useState<Record<string, ReadonlyMap<string, string>>>({});
  const reportLines = useCallback((view: string, value: ReadonlyMap<string, string> | null) => setLineMaps((current) => {
    if (value ? current[view] === value : !(view in current)) return current;
    const { [view]: _, ...rest } = current;
    return value ? { ...rest, [view]: value } : rest;
  }), []);
  const lines = useMemo(() => {
    const maps = Object.values(lineMaps);
    return maps.length > 1 ? new Map(maps.flatMap((map) => [...map])) : maps[0] ?? null;
  }, [lineMaps]);
  const focusDraft = useRef("");
  const list = comments?.list ?? [];
  const threads = new Map<string, { comments: CodeComment[]; drafts: string[] }>();
  const thread = (key: string) => {
    if (!threads.has(key)) threads.set(key, { comments: [], drafts: [] });
    return threads.get(key)!;
  };
  const fileComments: CodeComment[] = [];
  const stray: CodeComment[] = [];
  for (const comment of list) {
    const key = comment.line ? anchorLine(comment.line, lines) : "";
    if (!comment.line) fileComments.push(comment);
    else if (key) thread(key).comments.push(comment);
    else stray.push(comment);
  }
  const strayDrafts: string[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    if (!draft.line || draft.comment) continue;
    // Until the diff reports its lines, a new draft stays where it was opened.
    const anchor = lines ? anchorLine(draft.line, lines) : lineKey(draft.line);
    if (anchor) thread(anchor).drafts.push(key);
    else strayDrafts.push(key);
  }
  const without = (key: string) => (current: Record<string, CodeDraft>) => {
    const { [key]: _, ...rest } = current;
    return rest;
  };
  const openDraft = (key: string, draft: CodeDraft) => {
    if (drafts[key]) {
      card.current?.querySelector<HTMLTextAreaElement>(`[data-draft="${CSS.escape(key)}"] textarea`)?.focus();
      return;
    }
    focusDraft.current = key;
    setDrafts((current) => ({ ...current, [key]: draft }));
  };
  const saveComment = async (key: string, command: CodeCommentCommand) => {
    if (!comments) return false;
    setFailed(null);
    setSavingKey(key);
    const { error } = await comments.save(command);
    setSavingKey("");
    if (error) setFailed({ key, message: error });
    return !error;
  };
  const closeDraft = (key: string) => {
    setDrafts(without(key));
    commentButton.current?.focus({ preventScroll: true });
  };
  const actions: CommentActions = {
    saving: !!comments?.saving,
    busy: (key) => savingKey === key,
    error: (key) => (failed?.key === key ? failed.message : ""),
    focus: (key) => {
      if (focusDraft.current !== key) return false;
      focusDraft.current = "";
      return true;
    },
    change: (key, text) => setDrafts((current) => current[key] ? { ...current, [key]: { ...current[key], text } } : current),
    save: async (key) => {
      const draft = drafts[key];
      if (draft && await saveComment(key, { kind: "save", id: draft.id, group: draft.comment?.group ?? section,
        path: draft.comment?.path ?? preview.file.path, ...(draft.line ? { line: draft.line } : {}), body: draft.text })) closeDraft(key);
    },
    cancel: (key) => {
      closeDraft(key);
      if (failed?.key === key) setFailed(null);
    },
    edit: (comment) => openDraft(editKey(comment), { id: comment.id, text: comment.body, line: comment.line, comment }),
    remove: (comment) => comments ? comments.save({ kind: "delete", id: comment.id }) : Promise.resolve({}),
    events: (comment) => comments?.threads[comment.id] ?? [],
    thread: (comment) => (command) => comments ? comments.save({ ...command, entry: comment.id }) : Promise.resolve({}),
    scope: comments?.scope ?? "",
  };
  const diffComments: DiffComments | undefined = comments && {
    threads: [...threads.keys()],
    render: (key) => <LineThread comments={threads.get(key)?.comments ?? []} draftKeys={threads.get(key)?.drafts ?? []} drafts={drafts} actions={actions} />,
    onAdd: (line) => openDraft(threads.get(lineKey(line))?.drafts[0] ?? lineKey(line), { id: crypto.randomUUID(), text: "", line }),
    onLines: list.some((comment) => comment.line) || Object.values(drafts).some((draft) => draft.line) ? reportLines : undefined,
  };
  const sendNote = async () => {
    if (await saveComment("note", { kind: "save", id: crypto.randomUUID(), group: section, path: preview.file.path, body: note.trim() }))
      setNote("");
  };
  const valid = reviewable(preview);
  const kind = fileKind(preview.file.path, !!preview.diff.image);
  const FileIcon = kindIcons[kind];
  const renamedFrom = preview.file.oldPath ? `, renamed from ${preview.file.oldPath}` : "";
  const [sinceHash, setSinceHash] = useState("");
  const contextKey = `${sinceViewed ? sinceHash : preview.diff.hash}:${source.version}`;
  const [expanded, setExpanded] = useState<{ key: string; model: ContextModel } | null>(null);
  const context = expanded?.key === contextKey ? expanded.model : null;
  const expand = (model: ContextModel) => setExpanded({ key: contextKey, model });
  useEffect(() => { if (searchMatch) setExpanded(null); }, [searchMatch]);
  const card = useRef<HTMLElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const commentButton = useRef<HTMLButtonElement>(null);
  const [viewer, setViewer] = useState<{ side: Side; data: Definition } | null>(null);
  const openViewer = async (button: HTMLButtonElement) => {
    const side = preview.file.status === "D" ? "old" : "new";
    const data = await openSourceFile(new URLSearchParams({ ...source, side, file: preview.file.path }), button);
    if (data) setViewer({ side, data });
  };
  const showsLines = !preview.error && !preview.diff.tooLarge && !preview.diff.binary && !preview.diff.empty && !preview.diff.image
    && !noContentNote(preview.diff.patch);
  return (
    <article
      className={`file-card ${reviewed ? "reviewed-file" : ""} ${collapsed ? "collapsed-file" : ""}`}
      id={anchor(section, preview.file.path)}
      ref={card}
    >
      <header className="file-toolbar">
        <button
          className="file-collapse-button"
          aria-label={`${collapsed ? "Expand" : "Collapse"} file ${preview.file.path}${renamedFrom}`}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(!collapsed)}
          ref={collapseButton}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <FileIcon className="file-type-icon" size={16}>
            <title>{fileKindLabels[kind]}</title>
          </FileIcon>
          <span className="file-title">
            {preview.file.oldPath ? (
              <RenamedPath from={preview.file.oldPath} to={preview.file.path} />
            ) : (
              <strong>{preview.file.path}</strong>
            )}
          </span>
        </button>
        <button
          className={context ? "reset-context active" : "reset-context"}
          aria-label="Reset context"
          onClick={() => {
            setExpanded(null);
            collapseButton.current!.focus({ preventScroll: true });
            if (topHidden(card.current!)) card.current!.scrollIntoView({ block: "start" });
          }}
        >
          <FoldVertical size={14} />
          <span>Reset context</span>
        </button>
        {preview.partial && <span className="pill">Selected blocks</span>}
        {size.deferred && <span className="pill">Large diff · {size.lines.toLocaleString()} lines</span>}
        <button
          className={viewed ? "viewed-button active" : "viewed-button"}
          aria-pressed={viewed}
          disabled={!valid || viewSaving}
          onClick={() => void toggleViewed()}
        >
          <Check size={14} />
          {viewSaving ? <LoaderCircle size={14} className="spin" /> : null}
          {viewSaving ? "Saving viewed version…" : preview.partial ? "Blocks viewed" : "Viewed"}
        </button>
        {!preview.diff.binary && !preview.diff.image && (
          <button
            className="icon-button"
            aria-label={`Open ${preview.file.path} in the source viewer`}
            title="Open in the source viewer"
            onClick={(event) => void openViewer(event.currentTarget)}
          >
            <Maximize2 size={15} />
          </button>
        )}
        {comments && (
          <button
            className={`icon-button comment-button${list.length ? " has-comments" : ""}`}
            aria-label={`Comment on ${preview.file.path}${list.length ? `, ${list.length} ${list.length === 1 ? "comment" : "comments"} so far` : ""}`}
            title="Comment on this file. Your agent reads comments with the review’s feedback."
            onClick={() => { if (collapsed) setCollapsed(false); openDraft("file", { id: crypto.randomUUID(), text: "" }); }}
            ref={commentButton}
          >
            <MessageSquarePlus size={15} />
            {list.length > 0 && <span className="comment-count" aria-hidden="true">{list.length}</span>}
          </button>
        )}
      </header>
      {viewSaveError && <p className="warning" role="alert">{viewSaveError}</p>}
      <div id={bodyId} hidden={collapsed}>
        <FileComments comments={fileComments} stray={stray} strayDrafts={strayDrafts} drafts={drafts} actions={actions}
          lineHint={!!diffComments && showsLines}
          note={note.trim() ? note : ""} onSendNote={comments ? sendNote : undefined} onDeleteNote={() => setNote("")} />
        {sinceViewed ? (
          <SinceViewedFile preview={preview} section={section} source={source}
            split={split} wrap={wrap} ignoreWhitespace={ignoreWhitespace}
            context={context} onContextChange={expand} onCompared={setSinceHash}
            comments={diffComments && { ...diffComments, newOnly: true }} />
        ) : preview.diff.image && !noContentNote(preview.diff.patch) ? (
          <ImageDiff key={preview.diff.hash} preview={preview} split={split} source={source} />
        ) : (
          // Unkeyed: a remount would collapse the diff to a placeholder and shift the page.
          <DiffView
            preview={preview}
            searchMatch={searchMatch}
            onSearchReady={onSearchReady}
            eager={eager && !collapsed}
            split={split}
            wrap={wrap}
            ignoreWhitespace={ignoreWhitespace}
            source={source}
            context={context}
            onContextChange={expand}
            comments={diffComments}
          />
        )}
      </div>
      {viewer && <DefinitionDialog source={source} side={viewer.side} initial={viewer.data}
        change={firstChange(preview.diff.patch)} split={split} wrap={wrap} ignoreWhitespace={ignoreWhitespace} onClose={() => setViewer(null)} />}
    </article>
  );
}
function FileOutlineItem({
  preview,
  worktree,
  reviewed,
  current,
  onClick,
}: {
  preview: FilePreview;
  worktree: string;
  reviewed: boolean;
  current?: boolean;
  onClick: () => void;
}) {
  const size = useMemo(() => diffSize(preview.diff.patch), [preview.diff.patch]);
  const { viewed: done } = useFileState(worktree, markedFile(preview), reviewed, size.deferred);
  const hoverCard = useHoverCard();
  const { status, path, oldPath } = preview.file;
  const change = statusNames[status] ?? "Changed";
  const from = oldPath ? ` from ${oldPath}` : "";
  const kind = fileKind(path, !!preview.diff.image);
  const KindIcon = kindIcons[kind];
  // Too-large, failed, and combined (merge conflict) diffs have no rows to count.
  const lines =
    size.plus + size.minus || preview.partial
      ? size
      : { plus: preview.file.additions, minus: preview.file.deletions };
  return (
    <button
      className={`file-item${done ? " file-item-viewed" : ""}`}
      aria-current={current ? "location" : undefined}
      aria-label={`${path}, ${change.toLowerCase()}${from}${done ? ", viewed" : ""}`}
      aria-description={
        fileKindLabels[kind] +
        (lines.plus + lines.minus
          ? `, ${lines.plus.toLocaleString()} lines added, ${lines.minus.toLocaleString()} removed${preview.partial ? " in selected blocks" : ""}`
          : "")
      }
      onClick={onClick}
      {...hoverCard(() => (
        <>
          <p className="hover-card-path">
            <WrappablePath path={path} />
          </p>
          <p>
            {change} · {fileKindLabels[kind]}
            {lines.plus + lines.minus > 0 && (
              <>
                {" · "}
                <span className="additions">+{lines.plus.toLocaleString()}</span>{" "}
                <span className="deletions">−{lines.minus.toLocaleString()}</span>
                {preview.partial && " in selected blocks"}
              </>
            )}
            {done && " · Viewed"}
          </p>
          {oldPath && (
            <p>
              From <WrappablePath path={oldPath} />
            </p>
          )}
        </>
      ))}
    >
      {done ? <Check size={14} /> : <KindIcon size={14} />}
      <strong>{filename(path)}</strong>
      {status !== "M" && (
        <em className={`status-${change.toLowerCase().replace(" ", "-")}`}>
          {statusLetters[status] ?? status}
        </em>
      )}
      <ChangeMeter plus={lines.plus} minus={lines.minus} />
    </button>
  );
}
type DisplayedSections = ReturnType<typeof displaySections>;
type MatchJump = (section: string, preview: FilePreview, match: SearchMatch) => void;
function useOutlineSearch(sections: DisplayedSections) {
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState<SearchScope>("files");
  const documents = useMemo(() => sections.flatMap(({ section, files }) => files.map((preview) => ({
    key: `${section.id}:${preview.file.path}`, path: preview.file.path, oldPath: preview.file.oldPath,
    patch: preview.diff.patch, unavailable: preview.diff.tooLarge,
  }))), [sections]);
  const { results, pending, error } = useReviewSearch(documents, filter, scope);
  const matching = new Map(results.map((result) => [result.key, result]));
  const searching = !!filter.trim();
  return {
    filter, setFilter, scope, setScope, searching, pending, matching,
    status: searching ? error ?? (pending ? "Searching…" : `${results.length} matching files`) : "",
    missing: scope === "files" ? 0 : documents.filter((document) => document.unavailable).length,
    visible: (section: string, files: FilePreview[]) => searching ? files.filter((preview) => matching.has(`${section}:${preview.file.path}`)) : files,
  };
}
type OutlineSearch = ReturnType<typeof useOutlineSearch>;
function ScopeSelect({ search }: { search: OutlineSearch }) {
  return <select aria-label="Search in" value={search.scope} onChange={(event) => search.setScope(event.target.value as SearchScope)}>
    <option value="files">File names</option><option value="contents">Changed content</option><option value="all">Names and content</option>
  </select>;
}
function SearchMatches({ search, section, preview, onMatch }: { search: OutlineSearch; section: string; preview: FilePreview; onMatch: MatchJump }) {
  const result = search.searching ? search.matching.get(`${section}:${preview.file.path}`) : undefined;
  return result?.matches.map((match, index) => <button className="search-match" key={index} onClick={() => onMatch(section, preview, match)}>
    <small>{match.side === "old" ? "Before" : "After"} · line {match.line}{result.count > 3 && index === 2 ? ` · ${result.count - 3} more matches` : ""}</small>
    <code>{match.text}</code>
  </button>);
}
// Needs a HoverCards around it.
function OutlineFiles({ files, worktree, reviewed, current, onFile, after }: {
  files: FilePreview[]; worktree: string; reviewed: boolean; current?: string;
  onFile: (preview: FilePreview) => void; after?: (preview: FilePreview) => React.ReactNode;
}) {
  return byFolder(files).map(({ folder, files }) => {
    const items = files.map((preview) => <React.Fragment key={preview.file.path}>
      <FileOutlineItem preview={preview} worktree={worktree} reviewed={reviewed} current={preview.file.path === current} onClick={() => onFile(preview)} />
      {after?.(preview)}
    </React.Fragment>);
    return folder
      ? <OutlineFolder key={`folder:${folder}`} path={folder}>{items}</OutlineFolder>
      : <React.Fragment key="root">{items}</React.Fragment>;
  });
}
function ReviewOutline({ sections, worktree, hideTestFiles, reviewedCount, totalGroups, defaultViewed, onJump, onMatch }: {
  sections: DisplayedSections; worktree: string; hideTestFiles: boolean;
  reviewedCount: number; totalGroups?: number; defaultViewed: (section: string) => boolean;
  onJump: (section: string, file?: string) => void; onMatch: MatchJump;
}) {
  const search = useOutlineSearch(sections);
  return <aside className="files-sidebar">
    <div className="outline-head"><label className="search-field"><Search size={14} />
      <input aria-label="Filter review outline" placeholder={search.scope === "files" ? "Find a file…" : "Search changed content…"}
        value={search.filter} onChange={(event) => search.setFilter(event.target.value)} />
    </label>{totalGroups !== undefined && <small>{reviewedCount}/{totalGroups} reviewed</small>}</div>
    <label className="search-scope">Search in <ScopeSelect search={search} /></label>
    {search.status && <p className="search-status" role="status">{search.status}</p>}
    {search.missing > 0 && <p className="search-status">{search.missing} oversized files have no searchable preview.</p>}
    <nav aria-label="Changed files" aria-busy={search.pending && search.searching}><HoverCards>
      {sections.map(({ section, files }) => {
        const visible = search.visible(section.id, files);
        if (search.searching && !visible.length) return null;
        return <OutlineGroup key={section.id} title={section.title} reviewed={section.reviewed} revision={section.fingerprint}
          hiddenUnreadCount={hideTestFiles ? section.files.filter((preview) => isTestFile(preview.file.path) && !fileViewed(markedFile(preview), defaultViewed(section.id))).length : 0}
          filtering={search.searching} onJump={() => onJump(section.id)}>
          <OutlineFiles files={visible} worktree={worktree} reviewed={defaultViewed(section.id)} onFile={(preview) => onJump(section.id, preview.file.path)}
            after={(preview) => <SearchMatches search={search} section={section.id} preview={preview} onMatch={onMatch} />} />
          {!files.length && section.files.length > 0 && <small className="index-hidden">Test files hidden</small>}
        </OutlineGroup>;
      })}
    </HoverCards></nav>
  </aside>;
}
function CodeSearch({ sections, worktree, defaultViewed, onJump, onMatch }: {
  sections: DisplayedSections; worktree: string; defaultViewed: (section: string) => boolean;
  onJump: (section: string, file?: string) => void; onMatch: MatchJump;
}) {
  const search = useOutlineSearch(sections);
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const results = React.useId();
  const shown = open && search.searching;
  const pick = (action: () => void) => { setOpen(false); action(); };
  // Opening on focus would reopen the results each time the window regains focus.
  return <div className="code-search" onChange={() => setOpen(true)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={(event) => { if (event.key === "Escape" && shown) { event.stopPropagation(); field.current?.focus(); setOpen(false); } }}>
    <div className="search-field"><Search size={14} />
      <input ref={field} aria-label="Find in this part’s code" aria-expanded={shown} aria-controls={results}
        placeholder={search.scope === "files" ? "Find a file…" : "Search changed content…"} value={search.filter}
        onClick={() => setOpen(true)} onChange={(event) => search.setFilter(event.target.value)} />
      <ScopeSelect search={search} />
    </div>
    {/* Keeps focus in the field, so a click on a result isn't lost to the field's blur. */}
    {shown && <div className="code-search-results" id={results} aria-busy={search.pending} onMouseDown={(event) => event.preventDefault()}>
      <p className="search-status" role="status">{search.status}</p>
      {search.missing > 0 && <p className="search-status">{search.missing} oversized files have no searchable preview.</p>}
      <HoverCards>{sections.map(({ section, files }) => {
        const visible = search.visible(section.id, files);
        if (!visible.length) return null;
        return <section key={section.id}><h3>{section.title}</h3>
          <OutlineFiles files={visible} worktree={worktree} reviewed={defaultViewed(section.id)}
            onFile={(preview) => pick(() => onJump(section.id, preview.file.path))}
            after={(preview) => <SearchMatches search={search} section={section.id} preview={preview}
              onMatch={(group, file, match) => pick(() => onMatch(group, file, match))} />} />
        </section>;
      })}</HoverCards>
    </div>}
  </div>;
}

function MarkAllButton({ count, scope, complete = false, busy, disabled, onClick }: {
  count: number; scope: "part" | "review" | "collection"; complete?: boolean;
  busy: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button className={`review-button mark-all${complete ? " is-reviewed" : ""}`} disabled={disabled || complete} onClick={onClick}
      title={complete ? `All groups in this ${scope} are viewed` : `Mark the ${count} ${count === 1 ? "group" : "groups"} left in this ${scope} viewed`}>
      {busy ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}
      <span aria-live="polite">{complete ? "Part viewed" : `Mark ${scope} viewed`}</span>
    </button>
  );
}

function MarkErrors({ messages }: { messages: string[] }) {
  return messages.map((message) => <p className="warning mark-error" role="alert" key={message}>{message}</p>);
}

export default function App() {
  useDefinitionModifier();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState(params.get("collection") ?? "");
  const [reviewId, setReviewId] = useState(params.get("review") ?? "");
  const [path, setPath] = useState(params.get("path") ?? load("lastPath", ""));
  const [base, setBase] = useState(params.get("base") ?? "");
  const [mode, setMode] = useState<Mode>(
    (params.get("mode") as Mode) in modeLabels ? (params.get("mode") as Mode) : "branch",
  );
  const [repo, setRepo] = useState<Repository | null>(null);
  const [rawSnapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  // "collection" is the feature brief or the collection overview; "brief" is the selected review's brief.
  const [tab, setTab] = useState<"changes" | "collection" | "brief" | "commits" | "stack">(
    params.get("view") === "brief" ? (params.get("review") ? "brief" : "collection") : "changes");
  const [briefView, setBriefView] = useState<"brief" | "feedback">("brief");
  const [briefJump, setBriefJump] = useState("");
  const [featureJump, setFeatureJump] = useState("");
  const [replyJump, setReplyJump] = useState(false);
  const entered = useRef(false);
  const [groupJump, setGroupJump] = useState<CodeJump | null>(null);
  const preparedGroupJump = useRef<CodeJump | null>(null);
  const [origin, setOrigin] = useState(() => pageState().origin);
  const [stack, setStack] = useState<StackNode[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(!!(collectionId || path));
  const [repoBusy, setRepoBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [progressRefresh, setProgressRefresh] = useState(0);
  const [searchTarget, setSearchTarget] = useState<{ section: string; path: string; match: SearchMatch; version: number } | null>(null);
  const [reading, setReading] = useState({ group: "", file: "" });
  // A group or file the reader jumped to stays current while it's on screen, even when it's too near the end to reach the top.
  const picked = useRef({ group: "", file: "" });
  const hold = (group: string, file = "") => { picked.current = { group, file }; setReading({ group, file }); };
  const focusPlace = (group: string, file = "") => document.getElementById(anchor(group, file))
    ?.querySelector<HTMLElement>(file ? ".file-collapse-button" : ".group-heading h2")?.focus({ preventScroll: true });
  const [sinceViewedGroups, setSinceViewedGroups] = useState(() => new Map<string, boolean>());
  const [split, setSplit] = useState(load("split", false));
  const [wrap, setWrap] = useState(load("wrapLines", false));
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(load("ignoreWhitespace", false));
  const [hideTestFiles, setHideTestFiles] = useState(load("hideTestFiles", false));
  const [theme, setTheme] = useTheme();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [pathDraft, setPathDraft] = useState(path);
  const [marking, setMarking] = useState("");
  // Separate from `error`, which every refresh clears; a bulk mark's own saves trigger refreshes.
  const [markErrors, setMarkErrors] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>(load("recents", []));
  const folderDialog = useRef<HTMLDialogElement>(null);
  const jumped = useRef(false);
  const stopJump = useRef<(() => void) | null>(null);
  const onSearchReady = useCallback((row: HTMLElement) => {
    stopJump.current?.();
    stopJump.current = scrollToChange(row);
  }, []);
  const activeReview = useRef("");
  activeReview.current = `${collectionId}/${reviewId}`;
  const loadedPath = useRef("");
  const activeView = useRef("");
  const loadedView = useRef("");
  const collection = collections.find((entry) => entry.id === collectionId);
  const review = collection?.reviews.find((entry) => entry.id === reviewId);
  const briefed = !!(collection?.brief || collection?.reviews.some((entry) => entry.brief));
  const collectionBrief = useBrief(collection?.brief ? { collection } : null, refresh);
  const reviewBrief = useBrief(collection && review?.brief ? { collection, review } : null, refresh);
  const codeComments = useCodeComments(collectionId, review ? reviewId : "", refresh);
  const { entries: pullRequests, recheckPullRequests, refreshPullRequest } = usePullRequests(
    collection,
    refresh,
  );
  const repositoryPath = review?.path ?? path;
  const reviewRequest = review
    ? JSON.stringify({ collection: collectionId, review: reviewId, definition: review })
    : !collectionId && path && base
      ? JSON.stringify({ path, base, mode })
      : "";
  const scope = `${path}|${base}|${mode}`;
  activeView.current = `${activeReview.current}|${scope}`;
  useEffect(() => { setSinceViewedGroups(new Map()); }, [collectionId, reviewId, scope]);
  useEffect(() => { setMarkErrors([]); }, [collectionId, reviewId, tab]);
  const fileStateVersion = useFileStateVersion();
  const snapshot = useMemo(
    () =>
      rawSnapshot &&
      withFileViews(rawSnapshot, (file, fallback) => fileViewed(file, fallback)),
    [rawSnapshot, path, fileStateVersion],
  );
  const displayedSections = useMemo(
    () => displaySections(snapshot?.sections ?? [], hideTestFiles),
    [snapshot, hideTestFiles],
  );
  const placedComments = useMemo(() => placeComments(codeComments.comments, snapshot?.sections ?? []), [codeComments.comments, snapshot]);
  const repliedComments = useMemo(() => codeComments.comments.filter((comment) => threadState(comment, codeComments.threads[comment.id]).turn === "person"),
    [codeComments.comments, codeComments.threads]);
  const [replyTurn, setReplyTurn] = useState(0);
  const showReply = (turn: number) => {
    const comment = repliedComments[turn % repliedComments.length];
    setReplyTurn(turn + 1);
    if (isTestFile(comment.path)) setHideTestFiles(false);
    setGroupJump({ review: reviewId, group: comment.group, comment: { line: comment.line },
      file: { path: comment.path, start: comment.line?.number ?? 1, end: comment.line?.number ?? 1 } });
  };
  const reviewFeedback = reviewBrief.snapshot && threadCounts(reviewBrief.snapshot.feedback, reviewBrief.snapshot.threads,
    threadCounts(codeComments.comments, codeComments.threads));
  const hiddenTestCount = hideTestFiles
    ? snapshot?.comparison.files.filter((file) => isTestFile(file.path)).length ?? 0
    : 0;
  const initialJump = useMemo(() => {
    if (!snapshot || jumped.current) return null;
    const file = params.get("file");
    let id = location.hash.slice(1);
    if (file) {
      const entry = displayedSections.find(({ files }) =>
        files.some((preview) => preview.file.path === file),
      );
      id = entry ? anchor(entry.section.id, file) : "";
    }
    if (!id) return null;
    const eager = new Set<string>();
    for (const { section, files } of displayedSections) {
      if (anchor(section.id) === id) return { id, eager };
      for (const preview of files) {
        const fileId = anchor(section.id, preview.file.path);
        if (fileId === id) { eager.add(fileId); return { id, eager }; }
      }
    }
    return null;
  }, [snapshot, displayedSections]);
  const defaultViewed = (section: string) =>
    rawSnapshot?.sections.find((entry) => entry.id === section)?.reviewed ?? false;
  const { items: itemProgress, sources: progressSources, record: recordProgress } = useCollectionProgress(
    collection,
    refresh + progressRefresh,
    reviewId,
    rawSnapshot,
  );
  const collectionStatus = collectionProgress(
    collection?.reviews.map((entry) => itemProgress[entry.id]) ?? [],
  );
  let collectionSummary = `${collectionStatus.reviewedItems} of ${collectionStatus.totalItems} items reviewed`;
  if (collectionStatus.complete) collectionSummary = "All changes reviewed";
  if (collectionStatus.checkingItems) collectionSummary = "Checking review status…";
  const reviewLeft = review && snapshot ? unviewedGroups(progressSource(snapshot)) : [];
  const collectionLeft = collection && !collectionStatus.checkingItems
    ? collection.reviews.flatMap((entry) => {
        const groups = progressSources[entry.id] ? unviewedGroups(progressSources[entry.id]) : [];
        return groups.length ? [{ review: entry, groups }] : [];
      })
    : [];
  const showCollection = () => {
    setTab("collection");
    setBriefView("brief");
    setProgressRefresh((value) => value + 1);
  };
  const comparison = snapshot?.comparison;

  // Polling, not an event stream: a stream per tab would use up the browser's six connections
  // per host and hang the app.
  useEffect(() => {
    let seen: Live | undefined;
    let pending = false;
    const check = () => {
      if (document.hidden || pending) return;
      pending = true;
      request<Live>("live")
        .then((next) => {
          if (seen && (next.instance !== seen.instance || next.reload !== seen.reload))
            location.reload();
          else if (seen && next.refresh !== seen.refresh) setRefresh((value) => value + 1);
          seen = next;
        })
        .catch(() => {})
        .finally(() => (pending = false));
    };
    check();
    const timer = setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  useEffect(() => {
    request<Collection[]>("collections")
      .then((result) => {
        setCollections(result);
        // Only the first load opens a review the way its link asks; later refreshes keep the reader's view.
        const first = !entered.current;
        entered.current = true;
        if (collectionId) {
          const selected = result.find((entry) => entry.id === collectionId);
          const linked = selected?.reviews.find((entry) => entry.id === reviewId);
          if (!selected)
            setError("This collection is unavailable. Open a folder or choose another collection.");
          else if (!reviewId) {
            setReviewId(selected.reviews[0].id);
            if (selected.brief) setTab("collection");
            else if (first && selected.reviews[0].brief) setTab("brief");
          }
          else if (!linked)
            setError("This review is unavailable. Choose another review from the collection.");
          else if (first && linked.brief && !params.get("view") && !params.get("file") && !location.hash) setTab("brief");
        }
      })
      .catch((cause) => setError(cause.message));
  }, [refresh]);
  useEffect(() => {
    if (!review) return;
    setPath(review.path);
    setBase(review.base);
    setMode(review.mode);
    setSnapshot(null);
  }, [review?.id, review?.path, review?.base, review?.mode, collectionId]);
  useEffect(() => {
    if (params.get("path") || collectionId) return;
    request<{ defaultPath: string }>("bootstrap")
      .then(({ defaultPath }) => {
        if (defaultPath && defaultPath !== path) openPath(defaultPath);
        else if (!path) setOpen(true);
      })
      .catch((cause) => setError(cause.message));
  }, []);
  useEffect(() => {
    if (open) folderDialog.current?.showModal();
    else folderDialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!repositoryPath || (collectionId && !review)) return;
    const abort = new AbortController();
    if (loadedPath.current !== repositoryPath) setRepo(null);
    setRepoBusy(true);
    request<Repository>("repository", { path: repositoryPath }, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        loadedPath.current = repositoryPath;
        setRepo(result);
        setRepoBusy(false);
        if (!base && !review) {
          setBase(load<string>(`base:${result.path}`, "") || result.defaultBase);
        }
        save("lastPath", result.path);
        setRecents((previous) => {
          const next = [result.path, ...previous.filter((value) => value !== result.path)].slice(
            0,
            8,
          );
          save("recents", next);
          return next;
        });
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setError(cause.message);
          setRepoBusy(false);
          if (!reviewRequest) setBusy(false);
        }
      });
    return () => abort.abort();
  }, [repositoryPath, refresh, !!review]);
  useEffect(() => {
    if (!reviewRequest) return;
    const abort = new AbortController();
    setBusy(true);
    setError("");
    // A refresh of the same comparison keeps the reader's place until the new snapshot arrives.
    if (loadedView.current !== activeView.current) {
      setSnapshot(null);
      setStack(null);
    }
    const { definition: _definition, ...values } = JSON.parse(reviewRequest);
    request<ReviewSnapshot>("review", values, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        // The saved review may have moved path, base, or mode while this request ran.
        loadedView.current = activeView.current;
        setSnapshot(result);
        setBusy(false);
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") {
          setError(cause.message);
          setBusy(false);
        }
      });
    return () => abort.abort();
  }, [reviewRequest, refresh]);
  useEffect(() => {
    if (tab !== "stack" || !repo) return;
    const abort = new AbortController();
    setStack(null);
    request<StackNode[]>("stack", { path }, abort.signal)
      .then(setStack)
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message);
      });
    return () => abort.abort();
  }, [tab, repo]);
  useEffect(() => {
    if (tab === "brief" && collection && review && !review.brief) setTab(collection.brief ? "collection" : "changes");
  }, [tab, collection, review]);
  useEffect(() => {
    if ((!path && !collectionId) || (collectionId && !review)) return;
    const featureBrief = tab === "collection" && !!collection?.brief;
    const briefShown = featureBrief || (tab === "brief" && !!review?.brief);
    const next = new URLSearchParams(
      featureBrief ? { collection: collectionId } : review ? { collection: collectionId, review: reviewId } : { path, base, mode },
    );
    if (params.get("file") && !jumped.current) next.set("file", params.get("file")!);
    // A plain review link opens its brief, so the code view names itself to survive a reload.
    if (briefShown) next.set("view", "brief");
    else if (review?.brief) next.set("view", "code");
    history.replaceState(history.state, "", `?${next}${briefShown ? "" : location.hash}`);
  }, [path, base, mode, review, collectionId, reviewId, tab, !!collection?.brief]);
  const scrollTo = (id: string) => {
    stopJump.current?.();
    const target = document.getElementById(id);
    stopJump.current = target ? scrollToChange(target) : null;
  };
  useEffect(
    () => () => stopJump.current?.(),
    [collectionId, reviewId, scope, tab],
  );
  useEffect(() => {
    if (!snapshot || jumped.current) return;
    jumped.current = true;
    if (!initialJump) return;
    const frame = requestAnimationFrame(() => scrollTo(initialJump.id));
    return () => cancelAnimationFrame(frame);
  }, [snapshot, initialJump]);
  const selectReview = (nextCollection: Collection, nextReview = nextCollection.reviews[0], view: "entry" | "code" = "entry") => {
    setCollectionId(nextCollection.id);
    setReviewId(nextReview.id);
    setPath(nextReview.path);
    setBase(nextReview.base);
    setMode(nextReview.mode);
    if (nextCollection.id !== collectionId || nextReview.id !== reviewId) {
      setSnapshot(null);
      setBusy(true);
    }
    setTab(view === "entry" && nextReview.brief ? "brief" : "changes");
    setBriefView("brief");
    setBriefJump("");
    setReplyJump(false);
    setError("");
    window.scrollTo(0, 0);
    history.replaceState(history.state, "", location.pathname + location.search);
  };
  // Links push a history entry; pickers and tabs must replace the current one.
  const follow = (next: PageState) => {
    history.pushState({ preread: next }, "", location.href);
    setOrigin(next.origin);
  };
  const showCode = (owner: Collection, target: Review, reference: CodeJump) => {
    selectReview(owner, target, "code");
    if (reference.file ? isTestFile(reference.file.path)
      : target.groups.find((group) => group.id === reference.group)?.targets.every((target) => isTestFile(target.path))) setHideTestFiles(false);
    setGroupJump(reference);
  };
  const openCodeReference = (reference: CodeJump, view?: "brief" | "feedback") => {
    const target = collection?.reviews.find((entry) => entry.id === reference.review);
    if (!collection || !target) return;
    const feedback = view === "feedback" ? { view } : {};
    // Back returns to the tab the reader left, such as the comment they were working through on Feedback.
    const { view: _, ...left } = pageState();
    history.replaceState({ ...history.state, preread: { ...left, ...feedback } }, "", location.href);
    follow({ group: reference, origin: { collection: collection.id, ...(tab === "brief" ? { review: reviewId } : {}), ...feedback } });
    showCode(collection, target, reference);
  };
  const openReviewEntry = (id: string, block?: string, open?: "feedback" | "replies") => {
    const target = collection?.reviews.find((entry) => entry.id === id);
    if (!collection || !target) return;
    follow({});
    selectReview(collection, target);
    if (open && target.brief) setBriefView("feedback");
    if (open === "replies") setReplyJump(true);
    if (block && target.brief) setBriefJump(block);
  };
  const openReviewBrief = (view: "brief" | "feedback") => {
    setBriefView(view);
    setTab("brief");
  };
  useEffect(() => {
    if (!groupJump || tab !== "changes" || busy || !snapshot || groupJump.review !== reviewId) return;
    const { file: target, comment } = groupJump;
    const card = target && commentCard(groupJump.group, target.path, snapshot.sections);
    const [group, file] = card ? [card.group, card.path] : [groupJump.group, ""];
    const section = snapshot.sections.find((section) => section.id === group);
    const preview = card && section?.files.find((preview) => preview.file.path === card.path);
    if (section && preview && preparedGroupJump.current !== groupJump) {
      preparedGroupJump.current = groupJump;
      setSinceViewedGroups((current) => new Map(current).set(section.id, false));
      setFilesCollapsed(path, [markedFile(preview)], false);
      const key = !comment ? `new:${target?.start}` : comment.line ? anchorLine(comment.line, patchLines(preview.diff.patch)) : "";
      const match = key && searchLines(preview.diff.patch).find((line) => `${line.side}:${line.line}` === key);
      if (match) setSearchTarget({ section: section.id, path: preview.file.path, match, version: Date.now() });
    }
    const id = card || !comment ? anchor(group, file) : "unplaced-comments";
    const frame = requestAnimationFrame(() => {
      scrollTo(id);
      if (briefed && !comment) { hold(group, file); focusPlace(group, file); }
      setGroupJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [groupJump, tab, busy, snapshot, reviewId, path]);
  useEffect(() => {
    if (!replyJump || tab !== "changes" || busy || !snapshot || !codeComments.loaded) return;
    setReplyJump(false);
    if (repliedComments.length) showReply(0);
  }, [replyJump, tab, busy, snapshot, codeComments.loaded]);
  const spying = briefed && !!review && tab === "changes" && !!snapshot;
  useScrollPlace(spying, () => {
    const element = (group: string, file?: string) => document.getElementById(anchor(group, file));
    const pick = picked.current;
    let current = pick.group && onScreen(element(pick.group, pick.file)) ? displayedSections.find(({ section }) => section.id === pick.group) : undefined;
    let file = current ? pick.file : "";
    if (!current) {
      picked.current = { group: "", file: "" };
      current = displayedSections[0];
      for (const entry of displayedSections) {
        if (reached(element(entry.section.id))) current = entry;
        else break;
      }
    }
    if (!current) return;
    const group = current.section.id;
    if (!file) for (const preview of current.files) {
      if (reached(element(group, preview.file.path))) file = preview.file.path;
      else break;
    }
    setReading((previous) => previous.group === group && previous.file === file ? previous : { group, file });
  }, () => { picked.current = { group: "", file: "" }; }, [displayedSections]);
  const openPath = (next: string) => {
    setCollectionId("");
    setReviewId("");
    setPath(next.trim());
    setBase(load(`base:${next.trim()}`, ""));
    setSnapshot(null);
    setBusy(true);
    setOpen(false);
    setTab("changes");
  };
  const compare = (nextBase: string, nextMode: Mode) => {
    if (nextMode === mode && (comparesWithHead(mode) || nextBase === base)) {
      setRefresh((value) => value + 1);
      return;
    }
    setCollectionId("");
    setReviewId("");
    setBase(nextBase);
    setMode(nextMode);
    save(`base:${path}`, nextBase);
  };
  const jump = (section: string, file = "") => {
    scrollTo(anchor(section, file));
    history.replaceState(
      history.state,
      "",
      `${location.pathname}${location.search}#${anchor(section, file)}`,
    );
  };
  const advanceViewed = (current: HTMLElement) => {
    const files = Array.from(document.querySelectorAll<HTMLElement>(".review-feed .file-card"));
    const target = files[files.indexOf(current) + 1] ?? current;
    target.querySelector<HTMLButtonElement>(".file-collapse-button")?.focus({ preventScroll: true });
    scrollTo(target.id);
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${target.id}`);
  };
  const mark = async (section: ReviewSection) => {
    setMarking(section.id);
    setError("");
    const selection = `${collectionId}/${reviewId}`;
    try {
      const result = await mutate<ReviewSnapshot>("reviewed", {
        collection: collectionId,
        review: reviewId,
        groups: [{ group: section.id, fingerprint: section.fingerprint }],
        reviewed: !section.reviewed,
      });
      setFilesCollapsed(path, section.files.map(markedFile), !section.reviewed);
      const current = activeReview.current === selection;
      if (current) setSnapshot(result);
      return current;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setMarking("");
    }
  };
  // Marking collapses the files under the reader, so move on to the next group, as Viewed does for a file.
  const markFromBar = async (section: ReviewSection, next?: string) => {
    if (await mark(section) && !section.reviewed) jump(next ?? section.id);
  };
  // Group IDs can't contain "@", so these keys never light up a group's spinner.
  const saveMarks = async (key: string, targets: Array<{ review: Review; groups: ProgressSource["sections"] }>, reviewed: boolean) => {
    setMarking(key);
    const selection = collectionId;
    const errors: string[] = [];
    for (const target of targets) {
      try {
        const result = await mutate<ReviewSnapshot>("reviewed", {
          collection: selection,
          review: target.review.id,
          groups: target.groups.map((group) => ({ group: group.id, fingerprint: group.fingerprint })),
          reviewed,
        });
        setFilesCollapsed(target.review.path, target.groups.flatMap((group) => group.files), reviewed);
        recordProgress(selection, target.review.id, result);
        if (activeReview.current === `${selection}/${target.review.id}`) setSnapshot(result);
      } catch (cause) {
        const message = (cause as Error).message;
        errors.push(targets.length > 1 ? `“${target.review.title}”: ${message}` : message);
      }
    }
    setMarking("");
    return errors;
  };
  const markAll = async (key: string, targets: Array<{ review: Review; groups: ProgressSource["sections"] }>) => {
    setMarkErrors([]);
    const startedOn = activeReview.current;
    const errors = await saveMarks(key, targets, true);
    if (activeReview.current === startedOn) setMarkErrors(errors);
  };
  const markFromBrief = async (key: string, targets: MarkTargets, reviewed: boolean) => {
    if (!collection) return [];
    const resolved = targets.map((target) => ({ target, review: collection.reviews.find((entry) => entry.id === target.review),
      sections: progressSources[target.review]?.sections.filter((section) => target.groups.includes(section.id)) ?? [] }));
    const missing = resolved.find(({ target, review, sections }) => !review || sections.length !== target.groups.length);
    if (missing) return ["This code group’s status is still loading or changed. Refresh, then try again."];
    return saveMarks(key, resolved.map(({ review, sections }) => ({ review: review!, groups: sections })), reviewed);
  };
  const briefMentions = useMemo(() => {
    const mentions = new Map<string, { review?: string; target: string; heading: string }>();
    if (!collection) return mentions;
    const add = (brief: BriefDocument | undefined, owner?: string) => {
      for (const section of brief ? briefStructure(brief).sections : [])
        for (const target of section.groups) {
          const key = `${target.review}/${target.group}`;
          const existing = mentions.get(key);
          // A group's own part explains it better than the feature overview.
          if (!existing || (owner === target.review && existing.review !== target.review))
            mentions.set(key, { review: owner, target: section.heading?.key ?? section.start, heading: section.heading?.text ?? "" });
        }
    };
    add(collection.brief);
    for (const entry of collection.reviews) add(entry.brief, entry.id);
    return mentions;
  }, [collection]);
  const partBrief = reviewBrief.snapshot?.brief ?? review?.brief;
  const partStructure = useMemo(() => partBrief && briefStructure(partBrief), [partBrief]);
  const openBriefAt = (owner: string | undefined, place: string, group: string) => {
    if (!collection) return;
    const target = collection.reviews.find((entry) => entry.id === owner);
    if (owner !== undefined && !target) return;
    // Back returns to this group, not the one the code view first opened at.
    history.replaceState({ preread: { ...pageState(), group: { review: reviewId, group } } }, "", location.href);
    follow({});
    if (!target) { setFeatureJump(place); showCollection(); return; }
    selectReview(collection, target);
    setBriefJump(place);
  };
  const restorePage = useRef(() => {});
  restorePage.current = () => {
    const next = new URLSearchParams(location.search);
    const state = pageState();
    const owner = collections.find((entry) => entry.id === next.get("collection"));
    const part = owner?.reviews.find((entry) => entry.id === next.get("review"));
    if (!owner || (next.has("review") && !part)) { location.reload(); return; }
    setOrigin(state.origin);
    if (!part) {
      if (owner.id !== collectionId) selectReview(owner);
      showCollection();
      setBriefView(state.view ?? "brief");
    } else if (next.get("view") === "brief") {
      selectReview(owner, part);
      setBriefView(state.view ?? "brief");
    } else if (state.group) showCode(owner, part, state.group);
    else selectReview(owner, part, "code");
  };
  useEffect(() => {
    const restore = () => restorePage.current();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const originPart = origin?.review === undefined ? -1 : collection?.reviews.findIndex((entry) => entry.id === origin.review) ?? -1;
  const backTo = tab !== "changes" || !collection || origin?.collection !== collection.id ? ""
    : origin.review === undefined ? (collection.brief ? (origin.view ? "the feature’s feedback" : "the feature overview") : "")
    : originPart >= 0 ? `part ${originPart + 1}’s ${origin.view ?? "overview"}` : "";
  const reviewedCount = snapshot?.sections.filter((section) => section.reviewed).length ?? 0;
  const markingReview = marking === `@review:${reviewId}`;
  const partViewed = !!collection?.brief && reviewedCount > 0 && reviewedCount === snapshot?.sections.length;
  const markReviewButton = review && (reviewLeft.length > 0 || markingReview || partViewed) && (
    <MarkAllButton count={reviewLeft.length} scope={collection?.brief ? "part" : "review"}
      complete={partViewed && !markingReview} busy={markingReview} disabled={!!marking}
      onClick={() => markAll(`@review:${review.id}`, [{ review, groups: reviewLeft }])} />
  );
  const codeTab = tab === "changes" || tab === "commits" || tab === "stack";
  const framed = briefed && codeTab && !!collection && !!review;
  const showMatch: MatchJump = (section, preview, match) => {
    setSinceViewedGroups((current) => new Map(current).set(section, false));
    setFilesCollapsed(path, [markedFile(preview)], false);
    setSearchTarget({ section, path: preview.file.path, match, version: Date.now() });
    jump(section, preview.file.path);
  };
  const goTo = (section: string, file = "") => { hold(section, file); jump(section, file); focusPlace(section, file); };
  const goToMatch: MatchJump = (section, preview, match) => {
    hold(section, preview.file.path);
    showMatch(section, preview, match);
    focusPlace(section, preview.file.path);
  };

  const partIndex = collection && review ? collection.reviews.findIndex((entry) => entry.id === review.id) : -1;
  const comparisonChip = repo && (
    <Popover
      label="Comparison"
      className="comparison-chip"
      width={340}
      panel={(close) => (
        <ComparisonForm
          repo={repo}
          base={base}
          mode={mode}
          inCollection={!!review}
          untracked={!!comparison?.files.some((file) => file.untracked)}
          onCompare={(nextBase, nextMode) => {
            close();
            compare(nextBase, nextMode);
          }}
        />
      )}
    >
      <GitBranch size={14} />
      <strong>{repo.branch || repo.head.slice(0, 8)}</strong>
      <span>{comparisonSummary(mode, base)}</span>
      <ChevronDown size={13} />
    </Popover>
  );
  const notices = <>
    {error && (
      <div className="error" role="alert">
        {error}
        <button className="secondary" onClick={() => setRefresh((value) => value + 1)}>
          Retry
        </button>
      </div>
    )}
    {comparison?.warnings.map((warning) => (
      <p className="warning" key={warning}>
        {warning}
      </p>
    ))}
    {tab === "changes" && codeComments.error && !codeComments.loaded && (
      <p className="warning" role="alert">Comments on this review’s code could not be loaded. {codeComments.error}</p>
    )}
  </>;
  const loading = (busy || repoBusy) && !snapshot && !error && <Loading>Reading local changes…</Loading>;
  const feed = snapshot && (
    <div className={`review-feed${wrap ? " wrap-lines" : ""}${review ? " has-group-bars" : ""}`}>
      {codeComments.enabled && repliedComments.length > 0 && <p className="agent-replies-notice" role="status">
        <MessageSquareReply size={14} aria-hidden="true" />
        <span>Your agent replied to {repliedComments.length === 1 ? "a comment" : `${repliedComments.length} comments`} in this review.</span>
        <button onClick={() => showReply(replyTurn)}>{repliedComments.length === 1 ? "Show it" : "Show next"}</button>
      </p>}
      {codeComments.enabled && <UnplacedComments comments={placedComments.unplaced} threads={codeComments.threads} scope={`${collectionId}/${reviewId}`}
        groupTitle={review ? groupTitleIn(review) : () => undefined} saving={codeComments.saving}
        send={(comment) => (command) => codeComments.save({ ...command, entry: comment.id })}
        onRemove={(comment) => codeComments.save({ kind: "delete", id: comment.id })} />}
      {!comparison?.files.length && (
        <div className="empty-state">
          <CheckCheck size={28} />
          <h2>No changes in this comparison</h2>
          <p>Choose a different base or include local edits.</p>
        </div>
      )}
      {displayedSections.map(({ section, files }, index) => {
        const sinceViewed = sinceViewedGroups.get(section.id) ?? section.changedSinceReview;
        const mention = review ? briefMentions.get(`${review.id}/${section.id}`) : undefined;
        const number = String(index + 1).padStart(2, "0");
        const markState = { section, busy: marking === section.id, disabled: !!marking || (!section.canReview && !section.reviewed) };
        return <section className="change-group" id={anchor(section.id)} key={section.id}>
          <header className="group-header">
            <div className="group-heading">
              <span className="group-number">{number}</span>
              <div>
                <h2 tabIndex={-1}>{section.title}</h2>
                {mention && <button className="group-brief-link" onClick={() => openBriefAt(mention.review, mention.target, section.id)}
                  title={mention.review ? "Open where this part’s overview explains this group" : "Open where the feature overview explains this group"}>
                  <BookOpen size={12} />{mention.review ? "Part overview" : "Feature overview"}{mention.heading && <>: {mention.heading}</>}</button>}
              </div>
            </div>
            <div className="group-actions">
              {review && <GroupReviewButton {...markState} onClick={() => void mark(section)} />}
              {(section.changedSinceReview || sinceViewed) && (
                <button className="changed-label"
                  aria-pressed={sinceViewed}
                  onClick={() => setSinceViewedGroups((current) => new Map(current).set(section.id, !sinceViewed))}>
                  {sinceViewed ? "Show full review" : "Changed since review"}
                </button>
              )}
            </div>
          </header>
          {review && <GroupBar number={number} title={section.title} onTitle={() => jump(section.id)}>
            <GroupReviewButton {...markState} tabIndex={-1}
              onClick={() => void markFromBar(section, displayedSections[index + 1]?.section.id)} />
          </GroupBar>}
          {section.description && <div className="group-description"><Markdown>{section.description}</Markdown></div>}
          {review?.groups.some((group) => group.id === section.id) &&
            <ReviewVisuals key={`${collectionId}/${reviewId}/${section.id}`}
              collection={collectionId} review={reviewId} group={section.id}
              visuals={section.visuals} />}
          {section.warnings.map((warning) => (
            <p className="warning" key={warning}>
              {warning}
            </p>
          ))}
          {files.map((preview) => (
            <FileCard
              key={`${scope}:${section.id}:${preview.file.path}`}
              preview={preview}
              eager={initialJump?.eager.has(anchor(section.id, preview.file.path)) ?? false}
              section={section.id}
              split={split}
              wrap={wrap}
              ignoreWhitespace={ignoreWhitespace}
              reviewed={section.reviewed}
              defaultViewed={defaultViewed(section.id)}
              source={{ path, base, mode, version: snapshot!.comparison.version,
                ...(review ? { collection: collectionId, review: reviewId } : {}) }}
              onViewedSaved={(viewed) => {
                const savedPath = snapshot!.comparison.path ?? path;
                const savedHash = preview.viewHash;
                setSnapshot((current) => !current || (current.comparison.path ?? path) !== savedPath ? current : {
                  ...current,
                  sections: current.sections.map((group) => ({
                    ...group,
                    files: group.files.map((file) => file.file.path === preview.file.path && file.viewHash === savedHash ? { ...file, viewed } : file),
                  })),
                });
              }}
              onViewedAdvance={advanceViewed}
              onSearchReady={onSearchReady}
              searchMatch={searchTarget?.section === section.id && searchTarget.path === preview.file.path ? searchTarget : undefined}
              sinceViewed={sinceViewed && !!preview.lastViewed?.hasText}
              comments={codeComments.enabled ? {
                list: placedComments.cards.get(cardKey(section.id, preview.file.path)) ?? [],
                threads: codeComments.threads, scope: `${collectionId}/${reviewId}`,
                saving: codeComments.saving, save: codeComments.save,
              } : undefined}
            />
          ))}
          {!files.length && (
            <p className="empty-file">
              {section.files.length > 0
                ? "Test files hidden. Turn off Hide test files in Display settings to see them."
                : "No matching changes in this group."}
            </p>
          )}
        </section>;
      })}
      <footer className="feed-end">
        End of changes · {comparison?.files.length}{" "}
        {comparison?.files.length === 1 ? "file" : "files"}
        {hiddenTestCount > 0 && (
          <>
            {" "}· {hiddenTestCount} test {hiddenTestCount === 1 ? "file" : "files"} hidden
          </>
        )}
      </footer>
    </div>
  );
  const commitsView = tab === "commits" && snapshot && (
    <div className="section-content">
      <h2>Commits in this comparison</h2>
      {comparison?.commits.map((commit) => (
        <div className="commit-row" key={commit.sha}>
          <GitCommitHorizontal size={18} />
          <div>
            <strong>{commit.subject}</strong>
            <small>
              {commit.author} · {new Date(commit.date).toLocaleDateString()}
            </small>
          </div>
          <code>{commit.sha.slice(0, 8)}</code>
        </div>
      ))}
      {!comparison?.commits.length && <p className="muted">No commits in this comparison.</p>}
      {(comparison?.commitCount ?? 0) > 100 && <p>Showing the latest 100 commits.</p>}
    </div>
  );
  const stackView = tab === "stack" && (
    <div className="section-content">
      <h2>Git ancestry</h2>
      <p className="muted">
        The actual branch relationships, independent of how reviews are grouped in a
        collection.
      </p>
      {!stack ? (
        <Loading>Reading branch relationships…</Loading>
      ) : (
        stack.map((node) => (
          <div className={`stack-row ${node.relation}`} key={node.path}>
            <GitBranch size={18} />
            <div>
              <strong>{node.branch || node.head.slice(0, 8)}</strong>
              <small>
                {node.relation === "current"
                  ? "This worktree"
                  : `${node.distance} commits ${node.relation === "ancestor" ? "behind" : "ahead"}`}
              </small>
            </div>
            <code>{node.head.slice(0, 8)}</code>
            {node.path !== path && (
              <button className="secondary" onClick={() => openPath(node.path)}>
                Open
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
  const codeRail = ({ onClose, shut }: Drawer) => {
    if (!collection || !review) return null;
    const shown = new Map(displayedSections.map((entry) => [entry.section.id, entry]));
    const ids = snapshot?.sections.map((section) => section.id) ?? progressSources[review.id]?.sections.map((section) => section.id)
      ?? review.groups.map((group) => group.id);
    const inChanges = tab === "changes";
    const groups = new Map(ids.map((id): [string, ContentsGroup] => {
      const entry = shown.get(id);
      return [id, {
        id, title: entry?.section.title ?? groupTitle(review, id),
        state: groupReadState({ group: id, source: progressSources[review.id], progress: itemProgress[review.id] }),
        files: spying && entry && id === reading.group ? <HoverCards><div className="brief-contents-files">
          <OutlineFiles files={entry.files} worktree={path} reviewed={defaultViewed(id)} current={reading.file}
            onFile={(preview) => { shut(); goTo(id, preview.file.path); }} />
          {!entry.files.length && entry.section.files.length > 0 && <small className="index-hidden">Test files hidden</small>}
        </div></HoverCards> : undefined,
      }];
    }));
    const brief = reviewBrief.snapshot;
    return <BriefContents collection={collection} review={review} outline={partStructure?.outline ?? []} active=""
      counts={brief && partStructure ? headingCounts(brief, partStructure) : {}}
      progress={itemProgress} attention={(brief ?? collectionBrief.snapshot)?.attention} onClose={onClose}
      code={{ tree: partTree(review.id, ids, partStructure ?? { outline: [], sections: [] }), groups, current: spying ? reading.group : undefined,
        onGroup: (id) => { shut(); if (inChanges) goTo(id); else { setTab("changes"); setGroupJump({ review: review.id, group: id }); } } }}
      onHeading={(heading) => { shut(); openBriefAt(review.id, heading.key, reading.group || ids[0]); }}
      onFeature={() => { shut(); showCollection(); }}
      onReview={(id) => { shut(); if (id === review.id) window.scrollTo(0, 0); else openReviewEntry(id); }} />;
  };
  const codeFrame = framed && collection && review && (
    <ReviewFrame className="code-frame" eyebrow={`Part ${partIndex + 1} of ${collection.reviews.length}`} title={review.title}
      summary={review.description && <Description key={`description:${collectionId}/${reviewId}`} className="feature-brief-summary" text={review.description} />}
      tabs={review.brief && <BriefTabs label="Part views" current="code"
        feedback={reviewFeedback ? openThreads(reviewFeedback) : "…"} replies={reviewFeedback?.person}
        code={itemProgress[review.id] ? codeGroups([review], progressSources).remaining.length : "…"}
        onBrief={() => openReviewBrief("brief")} onCode={() => setTab("changes")} onFeedback={() => openReviewBrief("feedback")} />}
      rail={codeRail}>
      {repo && <div className="code-toolbar">
        <Segmented label="Code views" value={tab as "changes" | "commits" | "stack"} onChange={setTab} options={[
          ["changes", <>Changes <span className="pill">{comparison?.files.length ?? "–"}</span></>],
          ["commits", <>Commits{!!comparison?.commitCount && <span className="pill">{comparison.commitCount}</span>}</>],
          ["stack", "Git ancestry"],
        ]} />
        {tab === "changes" && snapshot && <CodeSearch key={`${collectionId}/${reviewId}|${scope}`} sections={displayedSections}
          worktree={path} defaultViewed={defaultViewed} onJump={goTo}
          onMatch={goToMatch} />}
        <div className="review-meta">
          {repo.dirty && <span className="pill">Local edits</span>}
          {review.scope === "groups" && <span className="pill" title="Only changes assigned to the named groups are included in this review and its totals.">Selected groups</span>}
          {comparisonChip}
          {comparison && <LineCounts files={comparison.files} />}
        </div>
      </div>}
      <div className="code-extras">
        {!collection.brief && markReviewButton}
        {!collection.brief && <MarkErrors messages={markErrors} />}
        <ReviewVisuals key={`visuals:${collectionId}/${reviewId}`} collection={collectionId} review={reviewId} visuals={review.visuals} />
        {review.pullRequest && <PullRequest url={review.pullRequest} entry={pullRequests[review.pullRequest]} comparison={comparison}
          mode={review.mode} onRefresh={() => refreshPullRequest(review.id)} />}
      </div>
      {notices}
      {loading}
      {tab === "changes" && feed}
      {commitsView}
      {stackView}
    </ReviewFrame>
  );

  return (
    <div className={`app${briefed ? " has-feature-brief" : ""}`}>
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-icon">
            <BrandMark />
          </span>
          <span>
            <span className="brand-pre">pre</span>read
          </span>
        </a>
        {backTo && <button className="back-link" onClick={() => history.back()} title={`Back to where you were in ${backTo}`}>
          <ArrowLeft size={15} /><span>Back<span className="back-link-place"> to {backTo}</span></span></button>}
        <nav className="crumbs" aria-label="Collection">
          <Layers3 size={15} />
          <Picker
            label="Review collection"
            value={collection?.id ?? ""}
            placeholder="Local comparison"
            searchable
            options={collections.map((entry) => ({
              value: entry.id,
              label: entry.title,
              detail: `${entry.reviews.length} ${entry.reviews.length === 1 ? "review" : "reviews"}${entry.brief ? " · overview" : ""}`,
            }))}
            onChange={(value) => {
              const selected = collections.find((entry) => entry.id === value);
              if (selected) { selectReview(selected); if (selected.brief) setTab("collection"); }
            }}
          />
          {collection && (
            <>
              <span className="slash">/</span>
              <Picker
                label="Review in collection"
                value={tab === "collection" && collection.brief ? "" : reviewId}
                placeholder={`${collection.reviews.length} ${collection.reviews.length === 1 ? "part" : "parts"}`}
                searchable
                options={[
                  ...(collection.brief ? [{ value: "", label: "Feature overview" }] : []),
                  ...collection.reviews.map((entry, index) => ({
                    value: entry.id,
                    label: `${index + 1}. ${entry.title}`,
                    detail: `${entry.brief ? "Overview · " : ""}${progressLabel(itemProgress[entry.id])}`,
                    complete: itemProgress[entry.id]?.status === "reviewed",
                    extra: entry.pullRequest && (
                      <PullRequestLine
                        url={entry.pullRequest}
                        entry={pullRequests[entry.pullRequest]}
                      />
                    ),
                  })),
                ]}
                onOpen={recheckPullRequests}
                onChange={(value) => {
                  if (!value) showCollection();
                  else selectReview(collection, collection.reviews.find((entry) => entry.id === value)!);
                }}
              />
              {collection.brief ? (
                tab !== "collection" && markReviewButton
              ) : (
                <button className="quiet collection-link" title="View collection"
                  aria-current={tab === "collection" ? "page" : undefined} onClick={showCollection}>
                  {collectionStatus.complete ? <><CheckCheck size={14} />Collection reviewed</> : <>
                      <span className="collection-link-text">View collection</span>
                      <span className="pill">
                        {collectionStatus.checkingItems
                          ? "Checking…"
                          : `${collectionStatus.reviewedItems}/${collectionStatus.totalItems} reviewed`}
                      </span>
                    </>}
                </button>
              )}
            </>
          )}
        </nav>
        <button
          className="open-button"
          title="Open folder"
          onClick={() => {
            setPathDraft(path);
            setOpen(true);
          }}
        >
          <FolderGit2 size={16} />
          <span>Open folder</span>
        </button>
        <button
          className="icon-button"
          title="Copy local review link"
          aria-label="Copy local review link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              setError("Copy this page’s address from the browser.");
            }
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
        <button
          className="icon-button"
          aria-label="Refresh local changes"
          title="Refresh local changes"
          onClick={() => {
            setMarkErrors([]);
            setRefresh((value) => value + 1);
          }}
        >
          <RefreshCw size={17} className={busy ? "spin" : ""} />
        </button>
        <Popover
          label="Display settings"
          title="Display settings"
          className="icon-button"
          width={280}
          panel={() => (
            <div className="settings">
              <div className="setting">
                <span>Diff layout</span>
                <Segmented
                  label="Diff layout"
                  value={split ? "split" : "unified"}
                  options={[
                    ["unified", "Unified"],
                    ["split", "Split"],
                  ]}
                  onChange={(value) => {
                    setSplit(value === "split");
                    save("split", value === "split");
                  }}
                />
              </div>
              <label className="setting-check">
                <input
                  type="checkbox"
                  checked={ignoreWhitespace}
                  onChange={(event) => {
                    setIgnoreWhitespace(event.target.checked);
                    save("ignoreWhitespace", event.target.checked);
                  }}
                />
                <span>
                  Ignore whitespace
                  <small>Hide changes to spaces and tabs; line breaks still show</small>
                </span>
              </label>
              <label className="setting-check">
                <input
                  type="checkbox"
                  checked={hideTestFiles}
                  onChange={(event) => {
                    setHideTestFiles(event.target.checked);
                    save("hideTestFiles", event.target.checked);
                  }}
                />
                <span>
                  Hide test files
                  <small>Tests still count toward review progress</small>
                </span>
              </label>
              <label className="setting-check">
                <input
                  type="checkbox"
                  checked={wrap}
                  onChange={(event) => {
                    setWrap(event.target.checked);
                    save("wrapLines", event.target.checked);
                  }}
                />
                <span>Wrap long lines</span>
              </label>
              <div className="setting">
                <span>Theme</span>
                <Segmented
                  label="Color theme"
                  value={theme}
                  options={[
                    ["system", "System"],
                    ["light", "Light"],
                    ["dark", "Dark"],
                  ]}
                  onChange={setTheme}
                />
              </div>
            </div>
          )}
        >
          <Settings size={17} />
        </Popover>
        {collection?.brief && tab !== "collection" && <MarkErrors messages={markErrors} />}
      </header>
      <main className="main">
        {codeTab && !framed && (
          <section className="review-header">
            <div className="title-row">
              <h1>
                {review?.title ||
                  (repo ? short(repo.branch) || "Local changes" : "Open a local worktree")}
              </h1>
              {repo?.dirty && <span className="pill">Local edits</span>}
              {review?.scope === "groups" && (
                <span className="pill" title="Only changes assigned to the named groups are included in this review and its totals.">
                  Selected groups
                </span>
              )}
              {markReviewButton}
            </div>
            {!collection?.brief && <MarkErrors messages={markErrors} />}
            {review?.description && (
              <Description key={`description:${collectionId}/${reviewId}`} text={review.description} />
            )}
            {review && <ReviewVisuals key={`visuals:${collectionId}/${reviewId}`}
              collection={collectionId} review={reviewId} visuals={review.visuals} />}
            {review?.pullRequest && (
              <PullRequest
                url={review.pullRequest}
                entry={pullRequests[review.pullRequest]}
                comparison={comparison}
                mode={review.mode}
                onRefresh={() => refreshPullRequest(review.id)}
              />
            )}
            {repo && (
              <div className="review-bar">
                <nav className="review-tabs" aria-label="Review sections">
                  <button
                    className={tab === "changes" ? "active" : ""}
                    aria-current={tab === "changes" ? "page" : undefined}
                    onClick={() => setTab("changes")}
                  >
                    <FileCode2 size={15} />
                    Changes <span className="pill">{comparison?.files.length ?? "–"}</span>
                  </button>
                  <button
                    className={tab === "commits" ? "active" : ""}
                    aria-current={tab === "commits" ? "page" : undefined}
                    onClick={() => setTab("commits")}
                  >
                    <GitCommitHorizontal size={15} />
                    Commits
                    {!!comparison?.commitCount && (
                      <span className="pill">{comparison.commitCount}</span>
                    )}
                  </button>
                  <button
                    className={tab === "stack" ? "active" : ""}
                    aria-current={tab === "stack" ? "page" : undefined}
                    onClick={() => setTab("stack")}
                  >
                    <GitBranch size={15} />
                    Git ancestry
                  </button>
                </nav>
                <div className="review-meta">
                  {comparisonChip}
                  {comparison && <LineCounts files={comparison.files} />}
                </div>
              </div>
            )}
          </section>
        )}
        {!framed && notices}
        {!repo && !busy && !repoBusy && !collectionId && !error && (
          <div className="welcome">
            <p>Compare changes, describe the decisions, and review them here.</p>
            <button className="primary" onClick={() => setOpen(true)}>
              <FolderGit2 size={16} />
              Open a folder
            </button>
          </div>
        )}
        {codeTab && !framed && loading}
        {framed && codeFrame}
        {tab === "changes" && snapshot && !framed && (
          <div className="changes-layout">
            <ReviewOutline key={`${collectionId}/${reviewId}|${scope}`} sections={displayedSections}
              worktree={path} hideTestFiles={hideTestFiles} reviewedCount={reviewedCount}
              totalGroups={review ? snapshot.sections.length : undefined} defaultViewed={defaultViewed}
              onJump={jump} onMatch={showMatch} />
            <SidebarResizer />
            {feed}
          </div>
        )}
        {tab === "collection" && collection?.brief && <FeatureBrief key={collection.id} collection={collection} brief={collectionBrief}
          progress={itemProgress} sources={progressSources} marking={marking} initialView={briefView} initialBlock={featureJump} onJumped={() => setFeatureJump("")}
          onCode={openCodeReference} onReview={openReviewEntry} onFeature={showCollection} onMark={markFromBrief} />}
        {tab === "brief" && collection && review?.brief && <FeatureBrief key={`${collection.id}/${review.id}`} collection={collection} review={review}
          brief={reviewBrief} progress={itemProgress} sources={progressSources} marking={marking} initialView={briefView} initialBlock={briefJump}
          initialFeedback={replyJump ? "person" : undefined} onJumped={() => { setBriefJump(""); setReplyJump(false); }} onCode={openCodeReference} onReview={openReviewEntry} onFeature={showCollection} onMark={markFromBrief}
          onCodeTab={() => { setTab("changes"); window.scrollTo(0, 0); }} codeComments={codeComments} />}
        {tab === "collection" && collection && !collection.brief && (
          <div className="section-content">
            <div className="section-heading">
              <div className="title-row">
                <h1>{collection.title}</h1>
                {(collectionLeft.length > 0 || marking === "@collection") && (
                  <MarkAllButton count={collectionLeft.reduce((sum, target) => sum + target.groups.length, 0)}
                    scope="collection" busy={marking === "@collection"} disabled={!!marking}
                    onClick={() => markAll("@collection", collectionLeft)} />
                )}
              </div>
              <MarkErrors messages={markErrors} />
              {collection.description && (
                <Description key={collection.id} text={collection.description} />
              )}
            </div>
            <div
              className={`collection-progress ${collectionStatus.complete ? "complete" : ""}`}
              aria-label="Collection review progress"
              aria-live="polite"
            >
              <div className="collection-progress-heading">
                {collectionStatus.complete ? <CheckCheck size={20} /> : <Layers3 size={20} />}
                <div>
                  <strong>{collectionSummary}</strong>
                  <p>
                    {collectionStatus.checkingItems
                      ? `Checking ${collectionStatus.checkingItems} remaining ${collectionStatus.checkingItems === 1 ? "item" : "items"}…`
                      : `${collectionStatus.reviewedGroups} of ${collectionStatus.totalGroups} change groups reviewed`}
                    {collectionStatus.emptyItems > 0 &&
                      ` · ${collectionStatus.emptyItems} with no changes`}
                  </p>
                </div>
              </div>
              <progress
                aria-label="Reviewed collection items"
                value={
                  collectionStatus.checkingItems
                    ? undefined
                    : collectionStatus.reviewedItems + collectionStatus.emptyItems
                }
                max={collectionStatus.totalItems || 1}
              />
            </div>
            <div className="collection-grid">
              {collection.reviews.map((entry, index) => (
                <article
                  className={`review-card ${entry.id === reviewId ? "current" : ""}`}
                  key={entry.id}
                >
                  <button
                    className="review-card-open"
                    onClick={() => selectReview(collection, entry)}
                  >
                    <span className="card-order">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{entry.title}</h3>
                      <p>{plainText(entry.description) || "No description yet."}</p>
                      <div
                        className={`item-progress status-${itemProgress[entry.id]?.status ?? "checking"}`}
                        title={itemProgress[entry.id]?.error}
                      >
                        {itemProgress[entry.id]?.status === "reviewed" && <CheckCheck size={14} />}
                        {!itemProgress[entry.id] && <LoaderCircle size={13} className="spin" />}
                        <span>{progressLabel(itemProgress[entry.id])}</span>
                      </div>
                    </div>
                    <span className="card-arrow">↗</span>
                  </button>
                  {entry.pullRequest && (
                    <PullRequest
                      compact
                      url={entry.pullRequest}
                      entry={pullRequests[entry.pullRequest]}
                    />
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
        {!framed && commitsView}
        {!framed && stackView}
      </main>
      <dialog ref={folderDialog} onCancel={() => setOpen(false)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            openPath(pathDraft);
          }}
        >
          <div className="dialog-heading">
            <h2>Open a local worktree</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close folder dialog"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <label>
            Folder path
            <input
              autoFocus
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              placeholder="/Users/you/Projects/app"
              required
            />
          </label>
          <p className="muted">
            Repository files stay untouched. Review details are saved locally.
          </p>
          <button className="primary" type="submit">
            Open folder
          </button>
          {recents.length > 0 && (
            <div className="recent-folders">
              <p className="eyebrow">RECENT FOLDERS</p>
              {recents.map((recent) => (
                <button type="button" key={recent} onClick={() => openPath(recent)}>
                  <FolderGit2 size={15} />
                  <span>{recent}</span>
                </button>
              ))}
            </div>
          )}
        </form>
      </dialog>
    </div>
  );
}
