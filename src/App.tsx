import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  FileImage,
  FoldVertical,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import "diff2html/bundles/css/diff2html.min.css";
import type { Diff, Mode, Repository, StackNode } from "./types";
import type { Collection, FilePreview, ReviewSection, ReviewSnapshot } from "./review-types";
import { showCarriageReturns, whitespaceDiff } from "./whitespace-diff";
import { useFileState, useFileStateVersion, fileViewed, setFilesViewed } from "./useFileState";
import { Picker } from "./Picker";
import { useCollectionProgress } from "./useCollectionProgress";
import { collectionProgress, progressLabel, withFileViews } from "./progress";
import { PullRequest } from "./PullRequest";
import { ImageDiff } from "./ImageDiff";
import { usePullRequests } from "./usePullRequests";
import {
  createContextModel,
  contextGaps,
  initialGaps,
  expandContext,
  contextPatch,
  type ContextModel,
} from "./diff-context";
import { highlightDiff } from "./highlight";
import "./style.css";

const params = new URLSearchParams(location.search);
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
function ThemePicker() {
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
  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <label className="theme-picker">
      <Icon size={15} />
      <Picker
        label="Color theme"
        value={theme}
        onChange={(value) => setTheme(value as Theme)}
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
    </label>
  );
}
type ContextSource = { path: string; base: string; mode: Mode; version: string };
// Gap rows gain buttons once context loads and can wrap onto a second line.
const gapRowsAbove = (element: HTMLElement, gap: number) => {
  let height = 0;
  const body = element.querySelector(".d2h-diff-tbody");
  for (const controls of body?.querySelectorAll<HTMLElement>(".context-controls") ?? [])
    if (Number(controls.dataset.gap) < gap) height += controls.getBoundingClientRect().height;
  return height;
};
function DiffView({
  preview,
  split,
  wrap,
  ignoreWhitespace,
  source,
  context,
  onContextChange,
}: {
  preview: FilePreview;
  split: boolean;
  wrap: boolean;
  ignoreWhitespace: boolean;
  source: ContextSource;
  context: ContextModel | null;
  onContextChange: (context: ContextModel) => void;
}) {
  const [contextStatus, setContextStatus] = useState<{ gap: number; error?: string } | null>(
    null,
  );
  const contextBusy = !!contextStatus && !contextStatus.error;
  const abort = useRef(new AbortController());
  const focusGap = useRef<number | null>(null);
  const rowsAbove = useRef<{ gap: number; height: number } | null>(null);
  const patch = context ? contextPatch(context) : preview.diff.patch;
  const reveal = async (gap: number, direction: "above" | "below" | "all") => {
    if (contextBusy) return;
    setContextStatus({ gap });
    focusGap.current = gap;
    try {
      let model = context;
      if (!model) {
        const expanded = await request<Diff>(
          "context",
          { ...source, file: preview.file.path, hash: preview.contextHash ?? preview.diff.hash },
          abort.current.signal,
        );
        model = createContextModel(preview.diff.patch, expanded.patch);
      }
      if (!abort.current.signal.aborted) {
        rowsAbove.current = { gap, height: gapRowsAbove(target.current!, gap) };
        onContextChange(expandContext(model, gap, direction));
        setContextStatus(null);
      }
    } catch (cause) {
      if (!abort.current.signal.aborted) setContextStatus({ gap, error: (cause as Error).message });
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!target.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "1000px" },
    );
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = target.current;
    if (!element || !visible || !patch || preview.error) return;
    const shown = showCarriageReturns(patch);
    const view = new Diff2HtmlUI(element, ignoreWhitespace ? whitespaceDiff(shown) : shown, {
      drawFileList: false,
      outputFormat: split ? "side-by-side" : "line-by-line",
      matching: "lines",
      highlight: false,
      synchronisedScroll: true,
      renderNothingWhenEmpty: false,
      fileContentToggle: false,
      stickyFileHeaders: false,
    });
    view.draw();
    // Merge before syntax highlighting introduces its own nested spans.
    for (const change of element.querySelectorAll(
      ".d2h-code-line-ctn > ins, .d2h-code-line-ctn > del",
    )) {
      while (change.nextSibling) {
        const gap = change.nextSibling;
        const next =
          gap.nodeType === Node.TEXT_NODE && /^\s*$/.test(gap.textContent ?? "")
            ? gap.nextSibling
            : gap;
        if (!(next instanceof Element) || next.tagName !== change.tagName) break;
        if (gap !== next) change.append(gap);
        change.append(...next.childNodes);
        next.remove();
      }
    }
    if (ignoreWhitespace) {
      for (const change of element.querySelectorAll(
        ".d2h-code-line-ctn > ins, .d2h-code-line-ctn > del",
      )) {
        if (!change.textContent?.trim()) change.replaceWith(...change.childNodes);
      }
    }
    highlightDiff(element);
    // A type change diffs as a deletion plus an addition, which share no context.
    const gaps =
      preview.file.status === "T" ? [] : context ? contextGaps(context) : initialGaps(patch);
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
        if (gap.below)
          button(
            !context && index === gaps.length - 1
              ? "↓ Show more below"
              : `↓ Show ${Math.min(20, gap.below)} lines below`,
            "below",
          );
        if (gap.above) button(`↑ Show ${Math.min(20, gap.above)} lines above`, "above");
        if (context && gap.all && Math.max(gap.above, gap.below) > 20)
          button(`Show all ${Math.max(gap.above, gap.below)} lines`, "all");
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
    return () => {
      element.innerHTML = "";
    };
  }, [patch, split, visible, context, ignoreWhitespace]);
  useEffect(() => {
    const element = target.current;
    if (!element || !visible || !split || !wrap) return;
    const sides = [...element.querySelectorAll(".d2h-file-side-diff")];
    if (sides.length !== 2) return;
    const [left, right] = sides.map((side) => [
      ...side.querySelectorAll<HTMLTableRowElement>("tbody > tr"),
    ]);
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
  let message = "";
  if (preview.error) message = preview.error;
  else if (preview.diff.tooLarge)
    message =
      "This diff is too large to preview. Open the file locally or choose a closer comparison base.";
  else if (preview.diff.binary)
    message = "Binary file changed. Open the file locally to inspect it.";
  else if (preview.diff.empty)
    message = "No text changes. This file may be empty or have a mode change.";
  return (
    <div className="diff-body">
      {message ? (
        <p className="empty-file">{message}</p>
      ) : (
        <div className={`diff-renderer ${visible ? "" : "deferred"}`} ref={target} />
      )}
    </div>
  );
}
function FileCard({
  preview,
  section,
  split,
  wrap,
  ignoreWhitespace,
  scope,
  reviewed,
  defaultViewed,
  source,
}: {
  preview: FilePreview;
  section: string;
  split: boolean;
  wrap: boolean;
  ignoreWhitespace: boolean;
  scope: string;
  reviewed: boolean;
  defaultViewed: boolean;
  source: ContextSource;
}) {
  const { viewed, collapsed, setViewed, setCollapsed } = useFileState(
    scope,
    preview.file.path,
    preview.diff.hash,
    defaultViewed,
  );
  const bodyId = `${anchor(section, preview.file.path)}-body`;
  const noteKey = `${scope}|${preview.file.path}`;
  const [notesOpen, setNotesOpen] = useState(false);
  const [note, setNote] = useState(load<Record<string, string>>("notes", {})[noteKey] ?? "");
  const valid =
    !preview.error && !preview.diff.tooLarge && (!preview.diff.binary || !!preview.diff.image);
  const FileIcon = preview.diff.image ? FileImage : FileCode2;
  const contextKey = `${preview.diff.hash}:${source.version}`;
  const [expanded, setExpanded] = useState<{ key: string; model: ContextModel } | null>(null);
  const context = expanded?.key === contextKey ? expanded.model : null;
  const card = useRef<HTMLElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  return (
    <article
      className={`file-card ${reviewed ? "reviewed-file" : ""} ${collapsed ? "collapsed-file" : ""}`}
      id={anchor(section, preview.file.path)}
      ref={card}
    >
      <header className="file-toolbar">
        <button
          className="file-collapse-button"
          aria-label={`${collapsed ? "Expand" : "Collapse"} file ${preview.file.path}`}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(!collapsed)}
          ref={collapseButton}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <FileIcon className="file-type-icon" size={16} />
          <span className="file-title">
            <strong>{preview.file.path}</strong>
            {preview.file.oldPath && <small>Renamed from {preview.file.oldPath}</small>}
          </span>
        </button>
        <button
          className={context ? "reset-context active" : "reset-context"}
          aria-label="Reset context"
          onClick={() => {
            setExpanded(null);
            collapseButton.current!.focus({ preventScroll: true });
            if (card.current!.getBoundingClientRect().top < 0)
              card.current!.scrollIntoView({ block: "start" });
          }}
        >
          <FoldVertical size={14} />
          <span>Reset context</span>
        </button>
        {preview.partial && <span className="pill">Selected blocks</span>}
        <button
          className={viewed ? "viewed-button active" : "viewed-button"}
          aria-pressed={viewed}
          disabled={!valid}
          onClick={() => setViewed(!viewed)}
        >
          <Check size={14} />
          {preview.partial ? "Blocks viewed" : "Viewed"}
        </button>
        <button
          className="icon-button"
          aria-label={`Notes for ${preview.file.path}`}
          aria-expanded={notesOpen}
          title="Private notes"
          onClick={() => setNotesOpen(!notesOpen)}
        >
          <MessageSquare size={15} />
          {note && <span className="note-dot" />}
        </button>
      </header>
      {notesOpen && (
        <div className="notes-panel">
          <label>
            Private file notes <small>Saved in this browser</small>
            <textarea
              value={note}
              placeholder="What needs to change? What should we discuss?"
              onChange={(event) => {
                setNote(event.target.value);
                save("notes", {
                  ...load<Record<string, string>>("notes", {}),
                  [noteKey]: event.target.value,
                });
              }}
            />
          </label>
        </div>
      )}
      <div id={bodyId} hidden={collapsed}>
        {preview.diff.image ? (
          <ImageDiff key={preview.diff.hash} preview={preview} split={split} source={source} />
        ) : (
          <DiffView
            key={contextKey}
            preview={preview}
            split={split}
            wrap={wrap}
            ignoreWhitespace={ignoreWhitespace}
            source={source}
            context={context}
            onContextChange={(model) => setExpanded({ key: contextKey, model })}
          />
        )}
      </div>
    </article>
  );
}
function FileOutlineItem({
  preview,
  scope,
  reviewed,
  onClick,
}: {
  preview: FilePreview;
  scope: string;
  reviewed: boolean;
  onClick: () => void;
}) {
  const { viewed: done } = useFileState(scope, preview.file.path, preview.diff.hash, reviewed);
  return (
    <button
      className={`file-item${done ? " file-item-viewed" : ""}`}
      title={`${preview.file.path}${done ? " · Viewed" : ""}`}
      aria-label={`${preview.file.path}${done ? ", viewed" : ""}`}
      onClick={onClick}
    >
      {done ? (
        <Check size={14} />
      ) : preview.diff.image ? (
        <FileImage size={14} />
      ) : (
        <FileCode2 size={14} />
      )}
      <span>
        <strong>{filename(preview.file.path)}</strong>
        <small>
          {preview.file.path.includes("/")
            ? preview.file.path.slice(0, preview.file.path.lastIndexOf("/"))
            : "/"}
        </small>
      </span>
      <em>{preview.file.status}</em>
    </button>
  );
}
interface Editor {
  kind: "review" | "collection" | "group" | "new-group" | "save";
  title: string;
  description: string;
  groupId?: string;
  pullRequest?: string;
  files: string[];
}
export default function App() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState(params.get("collection") ?? "");
  const [reviewId, setReviewId] = useState(params.get("review") ?? "");
  const [path, setPath] = useState(params.get("path") ?? load("lastPath", ""));
  const [base, setBase] = useState(params.get("base") ?? "");
  const [baseDraft, setBaseDraft] = useState(base);
  const [mode, setMode] = useState<Mode>(
    (params.get("mode") as Mode) in modeLabels ? (params.get("mode") as Mode) : "branch",
  );
  const [repo, setRepo] = useState<Repository | null>(null);
  const [rawSnapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [tab, setTab] = useState<"changes" | "collection" | "commits" | "stack">("changes");
  const [stack, setStack] = useState<StackNode[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(!!(collectionId || path));
  const [repoBusy, setRepoBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [progressRefresh, setProgressRefresh] = useState(0);
  const [filter, setFilter] = useState("");
  const [split, setSplit] = useState(load("split", false));
  const [wrap, setWrap] = useState(load("wrapLines", false));
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(load("ignoreWhitespace", false));
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [pathDraft, setPathDraft] = useState(path);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState("");
  const [saveError, setSaveError] = useState("");
  const [recents, setRecents] = useState<string[]>(load("recents", []));
  const folderDialog = useRef<HTMLDialogElement>(null);
  const editDialog = useRef<HTMLDialogElement>(null);
  const jumped = useRef(false);
  const activeReview = useRef("");
  activeReview.current = `${collectionId}/${reviewId}`;
  const collection = collections.find((entry) => entry.id === collectionId);
  const review = collection?.reviews.find((entry) => entry.id === reviewId);
  const { entries: pullRequests, refreshPullRequest } = usePullRequests(collection, refresh);
  const repositoryPath = review?.path ?? path;
  const reviewRequest = review
    ? JSON.stringify({ collection: collectionId, review: reviewId, definition: review })
    : !collectionId && path && base
      ? JSON.stringify({ path, base, mode })
      : "";
  const scope = `${path}|${base}|${mode}`;
  const fileStateVersion = useFileStateVersion();
  const snapshot = useMemo(
    () =>
      rawSnapshot &&
      withFileViews(rawSnapshot, (file, hash, fallback) => fileViewed(scope, file, hash, fallback)),
    [rawSnapshot, scope, fileStateVersion],
  );
  const defaultViewed = (section: string) =>
    rawSnapshot?.sections.find((entry) => entry.id === section)?.reviewed ?? false;
  const itemProgress = useCollectionProgress(
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
  const showCollection = () => {
    setTab("collection");
    setProgressRefresh((value) => value + 1);
  };
  const comparison = snapshot?.comparison;
  const totals = comparison?.files.reduce(
    (sum, file) => ({ plus: sum.plus + file.additions, minus: sum.minus + file.deletions }),
    { plus: 0, minus: 0 },
  );

  useEffect(() => {
    request<Collection[]>("collections")
      .then((result) => {
        setCollections(result);
        if (collectionId) {
          const selected = result.find((entry) => entry.id === collectionId);
          if (!selected)
            setError("This collection is unavailable. Open a folder or choose another collection.");
          else if (!reviewId) setReviewId(selected.reviews[0].id);
          else if (!selected.reviews.some((entry) => entry.id === reviewId))
            setError("This review is unavailable. Choose another review from the collection.");
        }
      })
      .catch((cause) => setError(cause.message));
  }, [refresh]);
  useEffect(() => {
    if (!review) return;
    setPath(review.path);
    setBase(review.base);
    setBaseDraft(review.base);
    setMode(review.mode);
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
    if (editor) editDialog.current?.showModal();
    else editDialog.current?.close();
  }, [!!editor]);
  useEffect(() => {
    if (!repositoryPath || (collectionId && !review)) return;
    const abort = new AbortController();
    setRepo(null);
    setRepoBusy(true);
    request<Repository>("repository", { path: repositoryPath }, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setRepo(result);
        setRepoBusy(false);
        if (!base && !review) {
          const chosen = load<string>(`base:${result.path}`, "") || result.defaultBase;
          setBase(chosen);
          setBaseDraft(chosen);
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
    setSnapshot(null);
    setStack(null);
    const { definition: _definition, ...values } = JSON.parse(reviewRequest);
    request<ReviewSnapshot>("review", values, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
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
    if ((!path && !collectionId) || (collectionId && !review)) return;
    const next = new URLSearchParams(
      review ? { collection: collectionId, review: reviewId } : { path, base, mode },
    );
    if (params.get("file") && !jumped.current) next.set("file", params.get("file")!);
    history.replaceState(null, "", `?${next}${location.hash}`);
  }, [path, base, mode, review, collectionId, reviewId]);
  useEffect(() => {
    if (!snapshot || jumped.current) return;
    const target = params.get("file");
    const section = snapshot.sections.find((section) =>
      section.files.some((file) => file.file.path === target),
    );
    if (!target && location.hash)
      requestAnimationFrame(() =>
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }),
      );
    if (target && section)
      requestAnimationFrame(() =>
        document.getElementById(anchor(section.id, target))?.scrollIntoView({ block: "start" }),
      );
    jumped.current = true;
  }, [snapshot]);
  const selectReview = (nextCollection: Collection, nextReview = nextCollection.reviews[0]) => {
    setCollectionId(nextCollection.id);
    setReviewId(nextReview.id);
    setPath(nextReview.path);
    setBase(nextReview.base);
    setBaseDraft(nextReview.base);
    setMode(nextReview.mode);
    if (nextCollection.id !== collectionId || nextReview.id !== reviewId) {
      setSnapshot(null);
      setBusy(true);
    }
    setTab("changes");
    setFilter("");
    setError("");
    window.scrollTo(0, 0);
    history.replaceState(null, "", location.pathname + location.search);
  };
  const openPath = (next: string) => {
    setCollectionId("");
    setReviewId("");
    setPath(next.trim());
    setBase(load(`base:${next.trim()}`, ""));
    setBaseDraft(load(`base:${next.trim()}`, ""));
    setSnapshot(null);
    setBusy(true);
    setOpen(false);
    setTab("changes");
  };
  const jump = (section: string, file = "") => {
    document.getElementById(anchor(section, file))?.scrollIntoView({ block: "start" });
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${anchor(section, file)}`,
    );
  };
  const edit = (value: Editor) => {
    setEditor(value);
    setSaveError("");
  };
  const persist = async (next: Collection) => {
    const result = await mutate<Collection>("collections", next, "PUT");
    setCollections((previous) => [...previous.filter((entry) => entry.id !== result.id), result]);
    return result;
  };
  const saveEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setSaveError("");
    try {
      if (editor.kind === "save") {
        const id = `review-${crypto.randomUUID().slice(0, 8)}`;
        const next = await persist({
          id,
          title: editor.title,
          description: "",
          reviews: [
            {
              id: "changes",
              title: editor.title,
              description: editor.description,
              path: repo!.path,
              base,
              mode,
              groups: [],
              pullRequest: editor.pullRequest,
            },
          ],
        });
        selectReview(next);
      } else if (collection) {
        let next = { ...collection };
        if (editor.kind === "collection")
          next = { ...next, title: editor.title, description: editor.description };
        else
          next.reviews = collection.reviews.map((entry) => {
            if (entry.id !== reviewId) return entry;
            if (editor.kind === "review")
              return {
                ...entry,
                title: editor.title,
                description: editor.description,
                pullRequest: editor.pullRequest,
              };
            if (editor.kind === "new-group")
              return {
                ...entry,
                groups: [
                  ...entry.groups,
                  {
                    id: `group-${crypto.randomUUID().slice(0, 8)}`,
                    title: editor.title,
                    description: editor.description,
                    targets: editor.files.map((path) => ({ path })),
                  },
                ],
              };
            return {
              ...entry,
              groups: entry.groups.map((group) =>
                group.id === editor.groupId
                  ? { ...group, title: editor.title, description: editor.description }
                  : group,
              ),
            };
          });
        await persist(next);
      }
      setEditor(null);
    } catch (cause) {
      setSaveError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const mark = async (section: ReviewSection) => {
    setMarking(section.id);
    setError("");
    const selection = `${collectionId}/${reviewId}`;
    try {
      const result = await mutate<ReviewSnapshot>("reviewed", {
        collection: collectionId,
        review: reviewId,
        group: section.id,
        fingerprint: section.fingerprint,
        reviewed: !section.reviewed,
      });
      setFilesViewed(
        scope,
        section.files.map((preview) => ({ path: preview.file.path, hash: preview.diff.hash })),
        !section.reviewed,
      );
      if (activeReview.current === selection) setSnapshot(result);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setMarking("");
    }
  };
  const reviewedCount = snapshot?.sections.filter((section) => section.reviewed).length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-icon">
            <GitCompareArrows size={19} />
          </span>
          worktree <span>review</span>
        </a>
        <button
          className="open-button"
          onClick={() => {
            setPathDraft(path);
            setOpen(true);
          }}
        >
          <FolderGit2 size={16} />
          <span>Open folder</span>
        </button>
        <div className="top-spacer" />
        <ThemePicker />
        <span className="local-badge">
          <span />
          Local
        </span>
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
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={17} className={busy ? "spin" : ""} />
        </button>
      </header>
      <div className="collection-bar">
        <Layers3 size={15} />
        <Picker
          label="Review collection"
          value={collection?.id ?? ""}
          placeholder="Local comparison"
          searchable
          options={collections.map((entry) => ({
            value: entry.id,
            label: entry.title,
            detail: `${entry.reviews.length} reviews`,
          }))}
          onChange={(value) => {
            const selected = collections.find((entry) => entry.id === value);
            if (selected) selectReview(selected);
          }}
        />
        {collection && (
          <>
            <span className="slash">/</span>
            <Picker
              label="Review in collection"
              value={reviewId}
              searchable
              options={collection.reviews.map((entry, index) => ({
                value: entry.id,
                label: `${index + 1}. ${entry.title}`,
                detail: progressLabel(itemProgress[entry.id]),
                complete: itemProgress[entry.id]?.status === "reviewed",
              }))}
              onChange={(value) =>
                selectReview(
                  collection,
                  collection.reviews.find((entry) => entry.id === value)!,
                )
              }
            />
            <button className="quiet" onClick={showCollection}>
              {collectionStatus.complete ? (
                <>
                  <CheckCheck size={14} />
                  Collection reviewed
                </>
              ) : (
                <>
                  View collection{" "}
                  <span className="pill">
                    {collectionStatus.checkingItems
                      ? "Checking…"
                      : `${collectionStatus.reviewedItems}/${collectionStatus.totalItems} reviewed`}
                  </span>
                </>
              )}
            </button>
          </>
        )}
        {!collection && repo && (
          <button
            className="quiet"
            onClick={() =>
              edit({
                kind: "save",
                title: short(repo.branch) || repo.name,
                description: "",
                files: [],
              })
            }
          >
            <Plus size={14} />
            Save a named review
          </button>
        )}
      </div>
      <main className="main">
        <section className="review-header">
          <div className="eyebrow">
            {repo?.name ?? "LOCAL CODE REVIEW"}
            {collection && (
              <>
                <span> / </span>
                {collection.title}
              </>
            )}
          </div>
          <div className="title-row">
            <h1>
              {review?.title ||
                (repo ? short(repo.branch) || "Local changes" : "Open a local worktree")}
            </h1>
            {review && (
              <button
                className="icon-button"
                aria-label="Edit review details"
                onClick={() =>
                  edit({
                    kind: "review",
                    title: review.title,
                    description: review.description,
                    pullRequest: review.pullRequest,
                    files: [],
                  })
                }
              >
                <Pencil size={15} />
              </button>
            )}
            {repo?.dirty && <span className="pill">Local edits</span>}
          </div>
          {review?.description && <p className="review-description">{review.description}</p>}
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
            <div className="worktree-path">
              <GitBranch size={13} />
              <code>{repo.branch || repo.head.slice(0, 8)}</code>
              <span>·</span>
              <span title={path}>{path}</span>
            </div>
          )}
          {repo && (
            <>
              <form
                className="comparison-bar"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = baseDraft.trim() || base;
                  setBaseDraft(next);
                  if (next === base) setRefresh((value) => value + 1);
                  else {
                    setCollectionId("");
                    setReviewId("");
                    setBase(next);
                  }
                  save(`base:${path}`, next);
                }}
              >
                <label className="base-control">
                  <span>Base</span>
                  <input
                    aria-label="Base branch or commit"
                    list="branches"
                    value={baseDraft}
                    onChange={(event) => setBaseDraft(event.target.value)}
                    disabled={mode === "working" || mode === "staged"}
                  />
                  <datalist id="branches">
                    {repo.refs.map((ref) => (
                      <option key={ref} value={ref} />
                    ))}
                  </datalist>
                </label>
                <Picker
                  label="Changes to show"
                  value={mode}
                  options={Object.entries(modeLabels).map(([value, label]) => ({ value, label }))}
                  onChange={(value) => {
                    setCollectionId("");
                    setReviewId("");
                    setMode(value as Mode);
                  }}
                />
                <button className="secondary" type="submit">
                  Compare
                </button>
                <span className="comparison-tip">
                  {mode === "working" || mode === "staged"
                    ? "Compared with HEAD"
                    : "Changes since the shared ancestor"}
                </span>
              </form>
              <nav className="review-tabs" aria-label="Review sections">
                <button
                  className={tab === "changes" ? "active" : ""}
                  onClick={() => setTab("changes")}
                >
                  <FileCode2 size={16} />
                  Changes <span className="pill">{comparison?.files.length ?? "–"}</span>
                </button>
                {collection && (
                  <button className={tab === "collection" ? "active" : ""} onClick={showCollection}>
                    <Layers3 size={16} />
                    Collection
                  </button>
                )}
                <button
                  className={tab === "commits" ? "active" : ""}
                  onClick={() => setTab("commits")}
                >
                  <GitCommitHorizontal size={16} />
                  Commits
                </button>
                <button className={tab === "stack" ? "active" : ""} onClick={() => setTab("stack")}>
                  <GitBranch size={16} />
                  Git ancestry
                </button>
                <div className="top-spacer" />
                {totals && (
                  <div className="totals">
                    {comparison?.files.some((file) => file.untracked) && <small>tracked</small>}
                    <span className="additions">+{totals.plus}</span>
                    <span className="deletions">−{totals.minus}</span>
                  </div>
                )}
              </nav>
            </>
          )}
        </section>
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
        {!repo && !busy && !repoBusy && !collectionId && !error && (
          <div className="welcome">
            <p>Compare changes, describe the decisions, and review them here.</p>
            <button className="primary" onClick={() => setOpen(true)}>
              <FolderGit2 size={16} />
              Open a folder
            </button>
          </div>
        )}
        {(busy || repoBusy) && !snapshot && !error && <Loading>Reading local changes…</Loading>}
        {tab === "changes" && snapshot && (
          <div className="changes-layout">
            <aside className="files-sidebar">
              <div className="index-title">
                Review outline{" "}
                {review && (
                  <small>
                    {reviewedCount}/{snapshot.sections.length} reviewed
                  </small>
                )}
              </div>
              <label className="search-field">
                <Search size={14} />
                <input
                  aria-label="Filter review outline"
                  placeholder="Find a file…"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
              <nav aria-label="Changed files">
                {snapshot.sections.map((section) => (
                  <div className="index-group" key={section.id}>
                    <button className="index-group-title" onClick={() => jump(section.id)}>
                      {section.reviewed ? (
                        <CheckCheck size={15} className="additions" />
                      ) : (
                        <span className="group-dot" />
                      )}
                      <span>{section.title}</span>
                    </button>
                    {section.files
                      .filter((preview) =>
                        preview.file.path.toLowerCase().includes(filter.toLowerCase()),
                      )
                      .map((preview) => (
                        <FileOutlineItem
                          key={preview.file.path}
                          preview={preview}
                          scope={scope}
                          reviewed={defaultViewed(section.id)}
                          onClick={() => jump(section.id, preview.file.path)}
                        />
                      ))}
                  </div>
                ))}
              </nav>
              {review && (
                <button
                  className="add-group"
                  onClick={() => edit({ kind: "new-group", title: "", description: "", files: [] })}
                >
                  <Plus size={15} />
                  Add change group
                </button>
              )}
            </aside>
            <div className={`review-feed${wrap ? " wrap-lines" : ""}`}>
              <div className="feed-toolbar">
                <span>
                  {comparison?.files.length} {comparison?.files.length === 1 ? "file" : "files"} ·
                  scroll to review
                </span>
                <div className="diff-controls">
                  <label
                    className="wrap-toggle"
                    title="Hide differences in spaces and tabs; keep line breaks"
                  >
                    <input
                      type="checkbox"
                      checked={ignoreWhitespace}
                      onChange={(event) => {
                        setIgnoreWhitespace(event.target.checked);
                        save("ignoreWhitespace", event.target.checked);
                      }}
                    />
                    Ignore whitespace
                  </label>
                  <label className="wrap-toggle">
                    <input
                      type="checkbox"
                      checked={wrap}
                      onChange={(event) => {
                        setWrap(event.target.checked);
                        save("wrapLines", event.target.checked);
                      }}
                    />
                    Wrap lines
                  </label>
                  <div className="diff-switch" role="group" aria-label="Diff layout">
                    <button
                      aria-pressed={!split}
                      onClick={() => {
                        setSplit(false);
                        save("split", false);
                      }}
                    >
                      Unified
                    </button>
                    <button
                      aria-pressed={split}
                      onClick={() => {
                        setSplit(true);
                        save("split", true);
                      }}
                    >
                      Split
                    </button>
                  </div>
                </div>
              </div>
              {!comparison?.files.length && (
                <div className="empty-state">
                  <CheckCheck size={28} />
                  <h2>No changes in this comparison</h2>
                  <p>Choose a different base or include local edits.</p>
                </div>
              )}
              {snapshot.sections.map((section, index) => (
                <section className="change-group" id={anchor(section.id)} key={section.id}>
                  <header className="group-header">
                    <div className="group-heading">
                      <span className="group-number">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <h2>{section.title}</h2>
                        {section.description && <p>{section.description}</p>}
                        <small>
                          {section.files.length} {section.files.length === 1 ? "file" : "files"}
                          {section.files.some((file) => file.partial) &&
                            " · selected change blocks"}
                        </small>
                      </div>
                    </div>
                    <div className="group-actions">
                      {review?.groups.some((group) => group.id === section.id) && (
                        <button
                          className="icon-button"
                          aria-label={`Edit ${section.title}`}
                          onClick={() =>
                            edit({
                              kind: "group",
                              groupId: section.id,
                              title: section.title,
                              description: section.description,
                              files: [],
                            })
                          }
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {review && (
                        <button
                          className={`review-button ${section.reviewed ? "is-reviewed" : ""}`}
                          aria-pressed={section.reviewed}
                          title={
                            section.reviewed
                              ? "Unmark all files in this group"
                              : "Mark all files in this group viewed"
                          }
                          disabled={!!marking || (!section.canReview && !section.reviewed)}
                          onClick={() => mark(section)}
                        >
                          {marking === section.id ? (
                            <LoaderCircle size={15} className="spin" />
                          ) : (
                            <CheckCheck size={15} />
                          )}
                          {section.reviewed ? "All viewed" : "Mark all viewed"}
                        </button>
                      )}
                      {section.changedSinceReview && (
                        <span className="changed-label">Changed since review</span>
                      )}
                    </div>
                  </header>
                  {section.warnings.map((warning) => (
                    <p className="warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {section.files.map((preview) => (
                    <FileCard
                      key={`${scope}:${section.id}:${preview.file.path}`}
                      preview={preview}
                      section={section.id}
                      split={split}
                      wrap={wrap}
                      ignoreWhitespace={ignoreWhitespace}
                      scope={scope}
                      reviewed={section.reviewed}
                      defaultViewed={defaultViewed(section.id)}
                      source={{ path, base, mode, version: snapshot!.comparison.version }}
                    />
                  ))}
                  {!section.files.length && (
                    <p className="empty-file">No matching changes in this group.</p>
                  )}
                </section>
              ))}
              <footer className="feed-end">
                End of changes · {comparison?.files.length}{" "}
                {comparison?.files.length === 1 ? "file" : "files"}
              </footer>
            </div>
          </div>
        )}
        {tab === "collection" && collection && (
          <div className="section-content">
            <div className="section-heading">
              <div>
                <p className="eyebrow">REVIEW COLLECTION</p>
                <h2>{collection.title}</h2>
                <p>{collection.description}</p>
              </div>
              <button
                className="secondary"
                onClick={() =>
                  edit({
                    kind: "collection",
                    title: collection.title,
                    description: collection.description,
                    files: [],
                  })
                }
              >
                <Pencil size={14} />
                Edit details
              </button>
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
              <small>
                Completion follows Viewed files. Changed code needs review again.
              </small>
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
                      <p>{entry.description || "No description yet."}</p>
                      <div
                        className={`item-progress status-${itemProgress[entry.id]?.status ?? "checking"}`}
                        title={itemProgress[entry.id]?.error}
                      >
                        {itemProgress[entry.id]?.status === "reviewed" && <CheckCheck size={14} />}
                        {!itemProgress[entry.id] && <LoaderCircle size={13} className="spin" />}
                        <span>{progressLabel(itemProgress[entry.id])}</span>
                      </div>
                      <code>Base: {entry.base}</code>
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
        {tab === "commits" && snapshot && (
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
        )}
        {tab === "stack" && (
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
        )}
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
      <dialog
        ref={editDialog}
        onCancel={() => {
          if (!saving) setEditor(null);
        }}
      >
        <form onSubmit={saveEditor}>
          {editor && (
            <>
              <div className="dialog-heading">
                <h2>
                  {editor.kind === "new-group"
                    ? "Add a change group"
                    : editor.kind === "save"
                      ? "Save a named review"
                      : "Edit review details"}
                </h2>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close edit dialog"
                  disabled={saving}
                  onClick={() => setEditor(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <label>
                Name
                <input
                  autoFocus
                  value={editor.title}
                  onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                  required
                  maxLength={200}
                />
              </label>
              <label>
                Description
                <textarea
                  value={editor.description}
                  onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                  placeholder="What changes, why it matters, and what needs review."
                  rows={4}
                />
              </label>
              {(editor.kind === "review" || editor.kind === "save") && (
                <label>
                  Pull request URL (optional)
                  <input
                    type="url"
                    value={editor.pullRequest ?? ""}
                    onChange={(event) => setEditor({ ...editor, pullRequest: event.target.value })}
                    placeholder="https://github.com/owner/repo/pull/123"
                  />
                </label>
              )}
              {editor.kind === "new-group" && (
                <fieldset>
                  <legend>Files in this group</legend>
                  {comparison?.files.map((file) => (
                    <label className="file-checkbox" key={file.path}>
                      <input
                        type="checkbox"
                        checked={editor.files.includes(file.path)}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            files: event.target.checked
                              ? [...editor.files, file.path]
                              : editor.files.filter((path) => path !== file.path),
                          })
                        }
                      />
                      <span>{file.path}</span>
                    </label>
                  ))}
                  <p className="muted">
                    For selected blocks within a file, ask your agent to assign line ranges.
                  </p>
                </fieldset>
              )}
              {saveError && (
                <p className="error" role="alert">
                  {saveError}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  className="secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={saving || (editor.kind === "new-group" && !editor.files.length)}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </form>
      </dialog>
    </div>
  );
}
