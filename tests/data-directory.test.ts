import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDirectory } from "../server/collections.ts";

let home: string;
before(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "preread-home-")));
  process.env.HOME = home;
  delete process.env.PREREAD_DATA_DIR;
});
after(() => rm(home, { recursive: true, force: true }));

test("data saved under the old name keeps loading until ~/.preread exists", async () => {
  assert.equal(dataDirectory(), join(home, ".preread"));
  await mkdir(join(home, ".worktree-review"));
  assert.equal(dataDirectory(), join(home, ".worktree-review"));
  await mkdir(join(home, ".preread"));
  assert.equal(dataDirectory(), join(home, ".preread"));
  process.env.PREREAD_DATA_DIR = join(home, "elsewhere");
  assert.equal(dataDirectory(), join(home, "elsewhere"));
});
