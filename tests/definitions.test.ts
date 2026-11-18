import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { explorerChanges, folderChanges, folderMark } from "../src/SourceExplorer.tsx";
import { functionDefinition } from "../server/definitions.ts";
import { readInstalledFile } from "../server/package-definitions.ts";
import { reviewSource, sourceHash } from "../server/review-source.ts";
import { comparison } from "../server/git.ts";
import type { ChangedFile, Mode } from "../src/types.ts";

// A committed worktree with packages installed but ignored, as a real checkout has them.
async function worktree(t: TestContext, files: Record<string, string>) {
  const path = await realpath(await mkdtemp(join(tmpdir(), "package-definition-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ".gitignore": "node_modules/\n", ...files })) {
    await mkdir(dirname(join(path, file)), { recursive: true });
    await writeFile(join(path, file), text);
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, stdio: "pipe" });
  git("init", "-b", "main");
  git("add", ".");
  git("-c", "user.name=Reader", "-c", "user.email=test@example.test", "commit", "-m", "Base");
  const version = (await comparison(path, "main", "working")).version;
  // Clicks `name` where it appears inside the first line containing `context`.
  const click = (file: string, context: string, name: string) => {
    const lines = files[file].split("\n");
    const line = lines.findIndex(text => text.includes(context));
    assert.notEqual(line, -1, `${context} is in ${file}`);
    const column = lines[line].indexOf(context) + context.indexOf(name);
    return functionDefinition(path, "main", "working", "new", file, line + 1, column, name, version);
  };
  return { path, click };
}

const packages = {
  "node_modules/typed/package.json": '{"name":"typed","version":"1.2.3","types":"index.d.ts"}',
  "node_modules/typed/index.d.ts": '/// <reference path="./common.d.ts" />\ndeclare const typed: typed.Static;\nexport = typed;\n',
  "node_modules/typed/common.d.ts": "declare namespace typed {\n  interface Static {\n    pick(value: string): string;\n  }\n}\n",
  "node_modules/plain/package.json": '{"name":"plain","version":"0.1.0","main":"lib/index.js"}',
  "node_modules/plain/lib/index.js": "function helper() {\n  return 1;\n}\nexports.run = function run() {\n  return helper();\n};\n",
  "node_modules/typed-db/package.json": '{"name":"typed-db","version":"2.0.0","types":"index.d.ts"}',
  "node_modules/typed-db/index.d.ts": "export interface Query {\n  where(column: string): Query;\n  select(): Query;\n}\nexport default function connect(): Query;\n",
};

test("follow an aliased call through a barrel in the selected version, respecting local shadowing", async t => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "definition-test-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, stdio: "pipe" });
  const write = (file: string, code: string) => writeFile(join(path, file), code);
  git("init", "-b", "main");
  git("config", "user.name", "Reader");
  git("config", "user.email", "reader@example.test");
  await write("tsconfig.json", '{"compilerOptions":{"paths":{"@utils":["./barrel"]}}}');
  await write("barrel.ts", 'export { default as format } from "./implementation.js"');
  await write("call.ts", 'import { format as show } from "@utils";\nshow();\n{ const show = () => "local";\nshow(); }');
  const moduleText = (value: string) => `const label = "format";\nexport default function format() { return "${value}"; }\nexport { label };`;
  const implementation = (value: string) => write("implementation.ts", moduleText(value));
  await implementation("base");
  git("add", ".");
  git("commit", "-m", "Base");
  git("switch", "-c", "feature");
  await implementation("head");
  git("commit", "-am", "Head");
  await implementation("index");
  git("add", ".");
  await implementation("working");
  const lookup = async (mode: Mode, side: string, line = 2) =>
    functionDefinition(path, "main", mode, side, "call.ts", line, 0, "show", (await comparison(path, "main", mode)).version);
  for (const [mode, side, value] of [
    ["branch", "old", "base"], ["branch", "new", "head"], ["staged", "new", "index"], ["working", "new", "working"],
  ] as const) {
    const found = await lookup(mode, side);
    assert.equal(found.file, "implementation.ts");
    assert.equal(found.code, moduleText(value));
    assert.equal(found.line, 2);
    assert.ok(found.paths.includes("barrel.ts"));
  }
  assert.equal((await lookup("branch", "new", 4)).line, 3);
});

test("the browser lists unchanged files from the selected version and detects a different working copy", async t => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "source-browser-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: path, stdio: "pipe" });
  run("init", "-b", "main");
  await writeFile(join(path, "helper.ts"), "export const helper = 1;\n");
  run("add", ".");
  run("-c", "user.name=Reader", "-c", "user.email=test@example.test", "commit", "-m", "Initial");
  await writeFile(join(path, "helper.ts"), "export const helper = 2;\n");
  await writeFile(join(path, "local.txt"), "local");
  await symlink(join(tmpdir(), "outside-source.ts"), join(path, "link.ts"));
  const browse = async (mode: Mode) => reviewSource({ path, base: "main", mode, side: "new",
    version: (await comparison(path, "main", mode)).version });
  const committed = await browse("branch");
  assert.deepEqual([...committed.files], ["helper.ts"]);
  const before = await committed.read("helper.ts");
  assert.match(before, /1;/);
  assert.equal(await committed.editorTarget("helper.ts", before), null);
  const working = await browse("working");
  assert.ok(working.files.has("local.txt"));
  assert.equal(await working.editorTarget("local.txt", "local"), sourceHash("local"));
  await assert.rejects(working.read("../outside-source.ts"));
  await assert.rejects(working.read("link.ts"));
});

test("the Explorer colors additions, edits and deletions and opens absent files on their available side", async t => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "explorer-status-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, stdio: "pipe" });
  git("init", "-b", "main");
  for (const file of ["removed.ts", "edited.ts", "unchanged.ts", "old-name.ts"])
    await writeFile(join(path, file), "export default " + JSON.stringify(file));
  git("add", ".");
  git("-c", "user.name=Reader", "-c", "user.email=test@example.test", "commit", "-m", "Base");
  git("mv", "old-name.ts", "new-name.ts");
  await rm(join(path, "removed.ts"));
  await writeFile(join(path, "added.ts"), "export default 1");
  await writeFile(join(path, "edited.ts"), "export default 2");
  const version = (await comparison(path, "main", "working")).version;
  const source = { path, base: "main", mode: "working" as const, version };
  const after = await reviewSource({ ...source, side: "new" });
  const before = await reviewSource({ ...source, side: "old" });
  const changes = explorerChanges(after.changes);
  for (const [file, mark, side] of [
    ["added.ts", "A", "new"], ["edited.ts", "M", undefined], ["removed.ts", "D", "old"],
    ["old-name.ts", "D", "old"], ["new-name.ts", "A", "new"],
  ] as const) {
    assert.equal(changes.get(file)?.mark, mark);
    assert.equal(changes.get(file)?.side, side);
    assert.match(await (side === "old" ? before : after).read(file), /export default/);
  }
  assert.equal(changes.has("unchanged.ts"), false);
});

test("a changed file comes with its whole diff on each side that has it, so the viewer can show it", async t => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "source-diff-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, stdio: "pipe" });
  const lines = (name: string) => Array.from({ length: 20 }, (_, i) => `export const ${name}${i} = ${i};`).join("\n") + "\n";
  git("init", "-b", "main");
  for (const file of ["removed.ts", "unchanged.ts"]) await writeFile(join(path, file), "export default 1;\n");
  await writeFile(join(path, "old-name.ts"), lines("moved"));
  await writeFile(join(path, "edited.ts"), "export function helper() {}\n" + lines("edited"));
  await writeFile(join(path, "call.ts"), 'import { helper } from "./edited";\nhelper();\n');
  git("add", ".");
  git("-c", "user.name=Reader", "-c", "user.email=test@example.test", "commit", "-m", "Base");
  git("mv", "old-name.ts", "new-name.ts");
  await writeFile(join(path, "new-name.ts"), lines("moved").replace("moved19 = 19", "moved19 = 190"));
  await rm(join(path, "removed.ts"));
  await writeFile(join(path, "added.ts"), "export default 2;\n");
  await writeFile(join(path, "edited.ts"), "export function helper() {}\n" + lines("edited").replace("edited9 = 9", "edited9 = 90"));
  const version = (await comparison(path, "main", "working")).version;
  const source = { path, base: "main", mode: "working" as const, version };
  const after = await reviewSource({ ...source, side: "new" });
  const before = await reviewSource({ ...source, side: "old" });
  const rows = (patch = "") => patch.split("\n").filter(line => /^[ +-]/.test(line) && !/^(---|\+\+\+) /.test(line));

  const edited = await after.diff("edited.ts");
  assert.equal(edited?.path, "edited.ts");
  assert.equal(rows(edited?.patch).length, 22, "every line of the file, not just the change and its context");
  assert.deepEqual(await before.diff("edited.ts"), edited);
  assert.deepEqual(rows((await after.diff("added.ts"))?.patch), ["+export default 2;"]);
  assert.deepEqual(rows((await before.diff("removed.ts"))?.patch), ["-export default 1;"]);
  const renamed = await before.diff("old-name.ts");
  assert.equal(renamed?.path, "new-name.ts");
  assert.equal(renamed?.oldPath, "old-name.ts");
  assert.deepEqual(await after.diff("new-name.ts"), renamed);
  for (const [side, file] of [[after, "unchanged.ts"], [after, "removed.ts"], [before, "added.ts"]] as const)
    assert.equal(await side.diff(file), undefined, file);

  const found = await functionDefinition(path, "main", "working", "new", "call.ts", 2, 0, "helper", version);
  assert.equal(found.file, "edited.ts");
  assert.deepEqual(found.diff, edited);
});

test("a library call opens the installed package's source, even through a repository barrel", async t => {
  const { path, click } = await worktree(t, {
    ...packages,
    "barrel.ts": 'export { run } from "plain";\n',
    "call.ts": 'import { pick } from "typed";\nimport _ from "typed";\nimport { run } from "./barrel";\nimport { gone } from "missing-package";\npick("a");\n_.pick("b");\nrun();\ngone();\n',
  });
  const pick = await click("call.ts", 'pick("a")', "pick");
  assert.equal(pick.file, "node_modules/typed/common.d.ts");
  assert.equal(pick.line, 3);
  assert.deepEqual(pick.package, { name: "typed", version: "1.2.3" });
  assert.equal(pick.editorTarget, sourceHash(pick.code));
  assert.equal((await click("call.ts", '_.pick("b")', "pick")).file, "node_modules/typed/common.d.ts");
  const run = await click("call.ts", "run();", "run");
  assert.equal(run.file, "node_modules/plain/lib/index.js");
  assert.equal(run.line, 4);
  assert.deepEqual(run.package, { name: "plain", version: "0.1.0" });
  await assert.rejects(click("call.ts", "gone();", "gone"), /“gone” comes from missing-package, which isn't installed/);

  const version = (await comparison(path, "main", "working")).version;
  const inside = await functionDefinition(path, "main", "working", "new", "node_modules/plain/lib/index.js", 5, 9, "helper", version);
  assert.equal(inside.file, "node_modules/plain/lib/index.js");
  assert.equal(inside.line, 1);
});

test("a method call resolves through types to the package or repository file that declares it", async t => {
  const { click } = await worktree(t, {
    ...packages,
    "db.js": 'import connect from "typed-db";\nfunction create() {\n  return connect();\n}\nexport const db = create();\n',
    "box.ts": "export const box = { /* TypeScript also breaks lines at \u2028 */\n  open() {\n    return 1;\n  },\n};\n",
    "query.ts": 'import { db } from "./db";\nimport { box } from "./box";\ndb.where("a").select();\nbox.open();\nObject.keys(box);\n',
  });
  const select = await click("query.ts", "select()", "select");
  assert.equal(select.file, "node_modules/typed-db/index.d.ts");
  assert.equal(select.line, 3);
  assert.deepEqual(select.package, { name: "typed-db", version: "2.0.0" });
  assert.equal((await click("query.ts", 'where("a")', "where")).line, 2);
  const open = await click("query.ts", "box.open()", "open");
  assert.equal(open.file, "box.ts");
  assert.equal(open.line, 2);
  assert.equal(open.package, undefined);
  await assert.rejects(click("query.ts", "Object.keys", "keys"), /No definition found for “keys”/);
});

test("installed files must stay inside the worktree's node_modules", async t => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), "outside-package-")));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "package.json"), '{"name":"escape","types":"index.d.ts"}');
  await writeFile(join(outside, "index.d.ts"), "export declare function leak(): void;\n");
  const { path, click } = await worktree(t, { ...packages, "call.ts": 'import { leak } from "escape";\nleak();\n' });
  await symlink(outside, join(path, "node_modules/escape"));
  await assert.rejects(click("call.ts", "leak();", "leak"), /“leak” comes from escape, which isn't installed/);
  assert.throws(() => readInstalledFile(path, "node_modules/escape/index.d.ts"), /can't be previewed/);
  assert.throws(() => readInstalledFile(path, "node_modules/../call.ts"), /outside the comparison/);
  assert.throws(() => readInstalledFile(path, "call.ts"), /outside the comparison/);
  const typed = readInstalledFile(path, "node_modules/typed/common.d.ts");
  assert.match(typed.code, /pick\(value: string\)/);
  assert.deepEqual(typed.package, { name: "typed", version: "1.2.3" });
});

test("a folder takes the color of what changed inside it", () => {
  const file = (path: string, status: string) => ({ path, status, additions: 0, deletions: 0, binary: false }) as ChangedFile;
  const folders = folderChanges(explorerChanges([
    file("src/a.ts", "A"), file("src/b.ts", "M"), file("src/new/c.ts", "A"),
    file("docs/old.md", "D"), file("lib/x.ts", "A"), file("lib/y.ts", "D"),
  ]));
  assert.deepEqual(folders.get("src"), { A: 2, M: 1, D: 0 });
  assert.deepEqual(folders.get("src/new"), { A: 1, M: 0, D: 0 });
  assert.equal(folders.has("src/a.ts"), false);
  assert.equal(folderMark(folders.get("src")!), "M");
  assert.equal(folderMark(folders.get("src/new")!), "A");
  assert.equal(folderMark(folders.get("docs")!), "D");
  assert.equal(folderMark(folders.get("lib")!), "M");
});

test("a workspace package resolves to its source in the review, and its link never reads other worktree files", async t => {
  const { path, click } = await worktree(t, {
    ".gitignore": "node_modules/\n.env\n",
    "packages/shared/package.json": '{"name":"@org/shared","main":"src/index.ts"}',
    "packages/shared/src/index.ts": "/* Shared helpers\u2028for every app */\nexport function helper() {\n  return 1;\n}\n",
    "packages/shared/.env": "SECRET=hunter2\n",
    "apps/web/call.ts": 'import { helper } from "@org/shared";\nhelper();\n',
  });
  await mkdir(join(path, "node_modules/@org"), { recursive: true });
  await symlink("../../packages/shared", join(path, "node_modules/@org/shared"));
  await symlink("..", join(path, "node_modules/self"));
  const helper = await click("apps/web/call.ts", "helper();", "helper");
  assert.equal(helper.file, "packages/shared/src/index.ts");
  assert.equal(helper.line, 2);
  assert.equal(helper.package, undefined);
  assert.throws(() => readInstalledFile(path, "node_modules/@org/shared/.env"), /can't be previewed/);
  assert.throws(() => readInstalledFile(path, "node_modules/@org/shared/package.json"), /can't be previewed/);
  assert.throws(() => readInstalledFile(path, "node_modules/self/.git/config"), /can't be previewed/);
});
