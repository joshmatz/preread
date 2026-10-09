import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import {
  realpath,
  stat,
  lstat,
  readFile,
  readlink,
  mkdtemp,
  copyFile,
  utimes,
  rm,
} from "node:fs/promises";
import { basename, resolve, isAbsolute, relative, sep, join, extname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type {
  ChangedFile,
  Comparison,
  Diff,
  ImageSide,
  Mode,
  Worktree,
  StackNode,
} from "../src/types.ts";
import { CONTEXT_LINES } from "../src/diff-context.ts";

const execute = promisify(execFile);
// Apple's /usr/bin/git dispatches through developer-tool discovery on every spawn.
// Resolve that installed binary once, while preserving any Git selected earlier in PATH.
const gitExecutable = async () => {
  if (process.platform !== "darwin") return "git";
  try {
    const selected = await execute("/usr/bin/which", ["git"], { timeout: 5000 });
    if (selected.stdout.trim() !== "/usr/bin/git") return "git";
    const installed = await execute("/usr/bin/xcrun", ["--find", "git"], { timeout: 5000 });
    return installed.stdout.trim() || "git";
  } catch {
    return "git";
  }
};
const executable = gitExecutable();
export const MAX_PATCH = 2 * 1024 * 1024;
export const MAX_IMAGE = 20 * 1024 * 1024;
const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
const flags = [
  "--no-optional-locks",
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.quotePath=false",
  "-c",
  "log.showSignature=false",
];
const options = (cwd: string, env: NodeJS.ProcessEnv = {}) => ({
  cwd,
  maxBuffer: 24 * 1024 * 1024,
  timeout: 20_000,
  env: {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    ...env,
  },
});
export const git = async (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const { stdout } = await execute(await executable, [...flags, ...args], {
    ...options(cwd, env),
    encoding: "utf8",
  });
  return stdout;
};
const gitBlob = async (cwd: string, object: string) => {
  const { stdout } = await execute(await executable, [...flags, "cat-file", "blob", object], {
    ...options(cwd),
    encoding: "buffer",
    maxBuffer: MAX_IMAGE,
  });
  return stdout;
};
// Diffing the working tree refreshes stat-dirty index entries and rewrites the index even
// with --no-optional-locks, so those reads use a private copy of the index.
const withPrivateIndex = async <TResult>(
  path: string,
  mode: Mode,
  read: (env: NodeJS.ProcessEnv) => Promise<TResult>,
) => {
  if (mode !== "all" && mode !== "working") return read({});
  const index = (
    await git(path, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
  ).trim();
  const directory = await mkdtemp(join(tmpdir(), "preread-"));
  const copy = join(directory, "index");
  try {
    try {
      const { atime, mtime } = await stat(index);
      await copyFile(index, copy, constants.COPYFILE_FICLONE);
      // Git rechecks files as new as the index file, so the copy keeps its mtime.
      await utimes(copy, atime, mtime);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return await read({ GIT_INDEX_FILE: copy });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
const localPath = async (input: string) => {
  if (!input || input.includes("\0")) throw new Error("Enter a local repository or worktree path.");
  const expanded =
    input === "~" ? homedir() : input.startsWith("~/") ? resolve(homedir(), input.slice(2)) : input;
  if (!isAbsolute(expanded))
    throw new Error("Use an absolute path, such as /Users/you/Projects/app.");
  return realpath(expanded);
};
export const rootFor = async (input: string) => {
  const path = await localPath(input);
  return (await git(path, ["rev-parse", "--show-toplevel"])).trim();
};
export const resolveRef = async (path: string, ref: string) => {
  if (!ref || ref.includes("\0")) throw new Error("Select a valid base branch or commit.");
  return (await git(path, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
};
export const worktreesFor = async (path: string): Promise<Worktree[]> => {
  const raw = await git(path, ["worktree", "list", "--porcelain", "-z"]);
  const records = raw
    .split("\0\0")
    .filter((record) => record && !record.split("\0").includes("bare"))
    .map((record) => {
      const fields = record.split("\0");
      const get = (key: string) =>
        fields.find((field) => field.startsWith(`${key} `))?.slice(key.length + 1) ?? "";
      return {
        path: get("worktree"),
        head: get("HEAD"),
        branch: get("branch").replace(/^refs\/heads\//, ""),
        detached: fields.includes("detached"),
        locked: fields.some((field) => field.startsWith("locked")),
      };
    });
  const existence = await Promise.all(
    records.map((record) =>
      stat(record.path).then(
        () => true,
        () => false,
      ),
    ),
  );
  return records.filter((_, index) => existence[index]);
};
export const repository = async (input: string) => {
  const path = await rootFor(input);
  const [trees, refsText, head, branch, commonDir, status, remoteHead] = await Promise.all([
    worktreesFor(path),
    git(path, [
      "for-each-ref",
      "--format=%(refname)%00%(refname:short)",
      "refs/heads",
      "refs/remotes",
    ]),
    resolveRef(path, "HEAD"),
    git(path, ["branch", "--show-current"]),
    git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(path, ["status", "--porcelain", "-z", "--untracked-files=normal"]),
    git(path, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => ""),
  ]);
  const refs = refsText
    .trim()
    .split("\n")
    .map((line) => line.split("\0"))
    .filter(([name]) => name && !name.endsWith("/HEAD"))
    .map(([, short]) => short);
  const defaultBase =
    [
      remoteHead.trim(),
      "origin/develop",
      "origin/main",
      "origin/master",
      "develop",
      "main",
      "master",
    ].find((ref) => ref && refs.includes(ref)) ?? "HEAD";
  return {
    path,
    name: basename(resolve(commonDir.trim(), "..")),
    commonDir: commonDir.trim(),
    branch: branch.trim(),
    head,
    dirty: !!status,
    worktrees: trees,
    refs,
    defaultBase,
  };
};
export const comparisonRefs = async (input: string, base: string, mode: Mode) => {
  if (!["branch", "all", "working", "staged"].includes(mode))
    throw new Error("Unknown comparison mode.");
  const path = await localPath(input);
  const usesBase = mode === "branch" || mode === "all";
  if (usesBase && (!base || base.includes("\0")))
    throw new Error("Select a valid base branch or commit.");
  const result = await git(path, [
    "rev-parse",
    "--show-toplevel",
    "--revs-only",
    "--end-of-options",
    "HEAD^{commit}",
    ...(usesBase ? [`${base}^{commit}`] : []),
  ]);
  const fields = result.trimEnd().split("\n");
  const commits = fields.splice(usesBase ? -2 : -1);
  if (commits.some((sha) => !/^[a-f0-9]{40,64}$/.test(sha)) || !fields.length)
    throw new Error("Select a valid base branch or commit.");
  return { path: fields.join("\n"), head: commits[0], baseSha: commits[1] ?? commits[0] };
};
export const comparisonSource = async (
  input: string,
  base: string,
  mode: Mode,
  refs?: Awaited<ReturnType<typeof comparisonRefs>>,
) => {
  const { path, head, baseSha } = refs ?? (await comparisonRefs(input, base, mode));
  const mergeBase =
    mode === "working" || mode === "staged"
      ? head
      : (await git(path, ["merge-base", baseSha, head])).trim();
  const revisions =
    mode === "branch" ? [mergeBase, head] : mode === "staged" ? ["--cached", head] : [mergeBase];
  return { path, head, baseSha, mergeBase, revisions };
};
export const parseStatuses = (text: string): ChangedFile[] => {
  const fields = text.split("\0");
  const files: ChangedFile[] = [];
  let index = 0;
  while (index < fields.length && fields[index]) {
    const status = fields[index];
    const first = fields[index + 1];
    index += 2;
    const renamed = status.startsWith("R") || status.startsWith("C");
    const path = renamed ? fields[index] : first;
    if (renamed) index += 1;
    if (path)
      files.push({
        path,
        ...(renamed ? { oldPath: first } : {}),
        status: status[0],
        additions: 0,
        deletions: 0,
        binary: false,
      });
  }
  return files;
};
const addStats = (files: ChangedFile[], text: string) => {
  const entries = text.split("\0");
  let index = 0;
  const byPath = new Map(files.map((file) => [file.path, file]));
  while (index < entries.length && entries[index]) {
    const entry = entries[index];
    index += 1;
    const firstTab = entry.indexOf("\t");
    const secondTab = entry.indexOf("\t", firstTab + 1);
    const additions = entry.slice(0, firstTab);
    const deletions = entry.slice(firstTab + 1, secondTab);
    let path = entry.slice(secondTab + 1);
    if (!path) {
      path = entries[index + 1];
      index += 2;
    }
    const file = byPath.get(path);
    if (file)
      Object.assign(file, {
        additions: Number(additions) || 0,
        deletions: Number(deletions) || 0,
        binary: additions === "-",
      });
  }
};
export const comparison = async (
  input: string,
  base: string,
  mode: Mode,
  source?: Awaited<ReturnType<typeof comparisonSource>>,
) => {
  const resolved = source ?? (await comparisonSource(input, base, mode));
  const { path, revisions, head, mergeBase } = resolved;
  const options = ["--no-ext-diff", "--no-textconv", "--find-renames"];
  const [[statuses, stats, untracked], commitsRaw, count] = await Promise.all([
    withPrivateIndex(path, mode, (env) =>
      Promise.all([
        git(path, ["diff", ...options, "--name-status", "-z", ...revisions, "--"], env),
        git(path, ["diff", ...options, "--numstat", "-z", ...revisions, "--"], env),
        mode === "all" || mode === "working"
          ? git(path, ["ls-files", "--others", "--exclude-standard", "-z"], env)
          : "",
      ]),
    ),
    git(path, [
      "log",
      "--max-count=100",
      "--format=%H%x00%s%x00%an%x00%aI%x00",
      `${mergeBase}..${head}`,
      "--",
    ]),
    git(path, ["rev-list", "--count", `${mergeBase}..${head}`, "--"]),
  ]);
  const files = parseStatuses(statuses);
  addStats(files, stats);
  const warnings: string[] = [];
  // Nested repositories and worktrees are listed as "dir/"; review them on their own.
  for (const name of untracked.split("\0").filter((name) => name && !name.endsWith("/"))) {
    files.push({
      path: name,
      status: "?",
      additions: 0,
      deletions: 0,
      binary: false,
      untracked: true,
    });
  }
  const dirtyStates =
    mode === "branch"
      ? []
      : await Promise.all(
          files.map(async (file) => {
            const info = await lstat(resolve(path, file.path)).catch(() => null);
            return `${file.path}:${info?.mtimeMs ?? "deleted"}:${info?.size ?? 0}`;
          }),
        );
  const fields = commitsRaw.split("\0");
  const commits = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    commits.push({
      sha: fields[index].trim(),
      subject: fields[index + 1],
      author: fields[index + 2],
      date: fields[index + 3],
    });
  }
  if (files.length > 2000)
    warnings.push(
      "This comparison contains more than 2,000 files. Use a closer base to review a smaller layer.",
    );
  return {
    base,
    ...resolved,
    revisions: undefined,
    files,
    commits,
    commitCount: Number(count.trim()),
    version: hash(head + mergeBase + mode + statuses + stats + dirtyStates.join("|")),
    warnings,
  };
};
export const fileDiff = async (
  input: string,
  base: string,
  mode: Mode,
  name: string,
  snapshot?: Comparison,
  contextLines = CONTEXT_LINES,
) => {
  const path = await rootFor(input);
  // Membership, rather than a user-supplied filesystem path, determines which files can be read.
  const info = snapshot ?? (await comparison(path, base, mode));
  const file = info.files.find((entry) => entry.path === name);
  if (!file)
    throw new Error("This file is not part of the current comparison. Refresh the review.");
  let patch = "";
  let tooLarge = false;
  let binary = file.binary;
  if (file.untracked) {
    const absolute = resolve(path, name);
    if ((await lstat(absolute)).isSymbolicLink()) {
      patch = `diff --git a/${name} b/${name}\nnew file mode 120000\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n+${await readlink(absolute)}\n\\ No newline at end of file\n`;
    } else {
      const contained = relative(path, await realpath(absolute));
      if (contained.startsWith(`..${sep}`) || isAbsolute(contained))
        throw new Error("This file resolves outside the repository. Review it locally.");
      const size = (await stat(absolute)).size;
      tooLarge = size > (imageType(name) ? MAX_IMAGE : MAX_PATCH);
      if (!tooLarge) {
        const content = await readFile(absolute);
        binary = content.includes(0);
        // Like Git's, the index line is the only part of a binary patch that tracks its content.
        if (binary)
          patch = `diff --git a/${name} b/${name}\nnew file mode 100644\nindex 0000000..${hash(content)}\nBinary files /dev/null and b/${name} differ\n`;
        else if (size > MAX_PATCH) tooLarge = true;
        else {
          const text = content.toString("utf8");
          const lines = text ? text.replace(/\n$/, "").split("\n") : [];
          patch = `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n${text && !text.endsWith("\n") ? "\\ No newline at end of file\n" : ""}`;
        }
      }
    }
  } else {
    const revisions =
      mode === "branch"
        ? [info.mergeBase, info.head]
        : mode === "staged"
          ? ["--cached", info.head]
          : [info.mergeBase];
    try {
      const args = [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--full-index",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        `--unified=${contextLines}`,
        ...revisions,
        "--",
        ...(file.oldPath ? [file.oldPath] : []),
        file.path,
      ];
      patch = await withPrivateIndex(path, mode, (env) => git(path, args, env));
      tooLarge = Buffer.byteLength(patch) > MAX_PATCH;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        tooLarge = true;
      else throw error;
    }
  }
  return {
    patch: tooLarge ? "" : patch,
    binary,
    tooLarge,
    empty: !patch && !binary && !tooLarge,
    hash: hash(patch),
  };
};
export async function trackedPatches(path: string, info: Comparison, mode: Mode) {
  const revisions =
    mode === "branch"
      ? [info.mergeBase, info.head]
      : mode === "staged"
        ? ["--cached", info.head]
        : [info.mergeBase];
  const args = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--find-renames",
    // Batched and per-file patches must hash identically regardless of Git abbreviation.
    "--full-index",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    `--unified=${CONTEXT_LINES}`,
    "--raw",
    "-z",
    "--patch",
    ...revisions,
    "--",
  ];
  const output = await withPrivateIndex(path, mode, (env) => git(path, args, env));
  if (!output) return new Map<string, string>();
  const boundary = output.indexOf("\0\0");
  if (boundary < 0) throw new Error("Could not read the changed-file patches.");
  const fields = output.slice(0, boundary).split("\0");
  const paths: string[] = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index].split(" ").at(-1)!;
    const renamed = status.startsWith("R") || status.startsWith("C");
    paths.push(fields[index + (renamed ? 2 : 1)]);
    index += renamed ? 3 : 2;
  }
  const patches = output
    .slice(boundary + 2)
    .split(/(?=^diff --git )/m)
    .filter(Boolean);
  if (patches.length !== paths.length) throw new Error("Could not match the changed-file patches.");
  return new Map(paths.map((name, index) => [name, patches[index]]));
}
export const stackFor = async (input: string): Promise<StackNode[]> => {
  const path = await rootFor(input);
  const trees = await worktreesFor(path);
  const head = await resolveRef(path, "HEAD");
  const nodes: StackNode[] = [];
  // Process a few Git reads at a time so large repositories do not spawn an unbounded process fan-out.
  for (let offset = 0; offset < trees.length; offset += 4) {
    const batch = await Promise.all(
      trees.slice(offset, offset + 4).map(async (tree): Promise<StackNode | null> => {
        if (tree.path === path) return { ...tree, relation: "current", distance: 0 };
        const common = await git(path, ["merge-base", head, tree.head]).then(
          (value) => value.trim(),
          () => "",
        );
        if (common !== tree.head && common !== head) return null;
        const relation = common === tree.head ? "ancestor" : "descendant";
        const range = relation === "ancestor" ? `${tree.head}..${head}` : `${head}..${tree.head}`;
        return {
          ...tree,
          relation,
          distance: Number((await git(path, ["rev-list", "--count", range, "--"])).trim()),
        };
      }),
    );
    nodes.push(...batch.filter((node): node is StackNode => !!node));
  }
  return nodes.sort((a, b) => {
    const position = (node: StackNode) =>
      node.relation === "ancestor" ? -node.distance : node.distance;
    return position(a) - position(b) || a.path.localeCompare(b.path);
  });
};

export async function fileContext(
  input: string,
  base: string,
  mode: Mode,
  name: string,
  version: string,
  expectedHash: string,
) {
  const info = await comparison(input, base, mode);
  const stale =
    "The file changed since this diff loaded. Refresh the review before expanding context.";
  if (!version || !expectedHash || info.version !== version) throw new Error(stale);
  const current = await fileDiff(input, base, mode, name, info);
  if (current.hash !== expectedHash) throw new Error(stale);
  const expanded = await fileDiff(input, base, mode, name, info, 1_000_000);
  if (expanded.tooLarge)
    throw new Error("This file is too large to expand here. Open it locally for the full context.");
  if (expanded.binary) throw new Error("Binary files do not have text context.");
  if (mode !== "branch") {
    const after = await comparison(input, base, mode);
    const afterDiff = await fileDiff(input, base, mode, name, after);
    if (after.version !== info.version || afterDiff.hash !== expectedHash) throw new Error(stale);
  }
  return expanded;
}

const imageTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
]);
const imageType = (name: string) => imageTypes.get(extname(name).toLowerCase());
// A type change swaps in a symlink or submodule on one side, which has no image to show.
const imageSides = (file: ChangedFile) =>
  file.status === "T"
    ? []
    : (["old", "new"] as const).filter((side) =>
        side === "old" ? !file.untracked && file.status !== "A" : file.status !== "D",
      );
const sidePath = (file: ChangedFile, side: ImageSide) =>
  side === "old" ? (file.oldPath ?? file.path) : file.path;
// Null means the working tree. Stage 0 is explicit so a path like "1:logo.png" isn't read as stage 1.
const imageObject = (info: Comparison, mode: Mode, file: ChangedFile, side: ImageSide) =>
  side === "old"
    ? `${info.mergeBase}:${sidePath(file, side)}`
    : mode === "branch"
      ? `${info.head}:${file.path}`
      : mode === "staged"
        ? `:0:${file.path}`
        : null;
const workingImage = async (root: string, name: string) => {
  const absolute = resolve(root, name);
  const stats = await lstat(absolute);
  const contained = relative(root, await realpath(absolute));
  if (!stats.isFile() || contained.startsWith(`..${sep}`) || isAbsolute(contained))
    throw new Error("This image isn't a regular file inside the repository. Review it locally.");
  return { absolute, size: stats.size };
};
const readImage = async (
  root: string,
  info: Comparison,
  mode: Mode,
  file: ChangedFile,
  side: ImageSide,
) => {
  const object = imageObject(info, mode, file, side);
  if (!object) {
    const { absolute, size } = await workingImage(root, file.path);
    return size > MAX_IMAGE ? null : readFile(absolute);
  }
  return gitBlob(root, object).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return null;
    throw error;
  });
};
// Anything that can't be previewed returns undefined and keeps the binary-file notice.
// Read the version represented by a preview, including rename-only and mode-only
// changes whose patch has no text hunks. Working files use the same containment
// and symlink checks as image previews; Git versions use pinned blob names.
export async function viewedFileText(input: string, base: string, mode: Mode,
  file: ChangedFile, info: Comparison, expectedHash: string): Promise<string | undefined> {
  if (file.binary || file.status === "T") return undefined;
  const root = await rootFor(input);
  let content: Buffer | null;
  if (file.status === "D") content = Buffer.alloc(0);
  else {
    const object = imageObject(info, mode, file, "new");
    if (!object && (await lstat(resolve(root, file.path))).isSymbolicLink()) return undefined;
    const size = object ? Number(await git(root, ["cat-file", "-s", object]))
      : (await workingImage(root, file.path)).size;
    if (size > MAX_PATCH) return undefined;
    content = await readImage(root, info, mode, file, "new");
  }
  if (!content || content.includes(0)) return undefined;
  const after = await fileDiff(root, base, mode, file.path, info);
  if (after.hash !== expectedHash)
    throw new Error("This file changed while reading its viewed version. Refresh and review it again.");
  return content.toString("utf8");
}
export async function imagePreview(
  root: string,
  info: Comparison,
  mode: Mode,
  file: ChangedFile,
): Promise<Diff["image"]> {
  const sides = imageSides(file);
  if (!sides.length || !sides.every((side) => imageType(sidePath(file, side)))) return undefined;
  try {
    const image: NonNullable<Diff["image"]> = {};
    for (const side of sides) {
      const object = imageObject(info, mode, file, side);
      const size = object
        ? Number(await git(root, ["cat-file", "-s", object]))
        : (await workingImage(root, file.path)).size;
      if (size > MAX_IMAGE) return undefined;
      image[side] = { size };
    }
    return image;
  } catch {
    return undefined;
  }
}
export async function fileImage(
  input: string,
  base: string,
  mode: Mode,
  name: string,
  side: string,
  expectedHash: string,
) {
  if (side !== "old" && side !== "new") throw new Error("Choose the old or new image.");
  const info = await comparison(input, base, mode);
  const file = info.files.find((entry) => entry.path === name);
  if (!file)
    throw new Error("This file is not part of the current comparison. Refresh the review.");
  const type = imageSides(file).includes(side) && imageType(sidePath(file, side));
  if (!type) throw new Error("This version of the file can't be previewed as an image.");
  const content = await readImage(info.path, info, mode, file, side);
  if (!content) throw new Error("This image is too large to preview. Open it locally.");
  // Checking after the read also catches an edit made while it ran.
  if ((await fileDiff(info.path, base, mode, name, info)).hash !== expectedHash)
    throw new Error("This image changed since the review loaded. Refresh the review to see it.");
  return { content, type };
}
