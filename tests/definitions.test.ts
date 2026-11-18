import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { explorerChanges } from "../src/SourceExplorer.tsx";
import { functionDefinition } from "../server/definitions.ts";
import { reviewSource, sourceHash } from "../server/review-source.ts";
import { comparison } from "../server/git.ts";
import type { Mode } from "../src/types.ts";

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
