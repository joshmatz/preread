import assert from "node:assert/strict";
import { test } from "node:test";
import { fileKind, isTestFile } from "../src/file-kinds.ts";

test("file kinds follow names, folders, and extensions", () => {
  const cases: [string, string][] = [
    ["src/delivery/worker.ts", "code"],
    ["src/config.ts", "code"],
    ["src/latest.ts", "code"],
    ["bin/preread", "code"],
    ["test/backoff.test.ts", "test"],
    ["src/RetryBadge.spec.tsx", "test"],
    ["src/staff-mcp/index.inttest.ts", "test"],
    ["src/RetryBadge.ui.test.tsx", "test"],
    ["pkg/client/client_test.go", "test"],
    ["app/tests/test_models.py", "test"],
    ["Tests/AppTests/LoginTests.swift", "test"],
    ["src/__snapshots__/Badge.test.tsx.snap", "test"],
    ["src/style.css", "styles"],
    ["README.md", "docs"],
    ["LICENSE", "docs"],
    ["docs/specs/api.md", "docs"],
    ["vite.config.ts", "config"],
    ["tsconfig.node.json", "config"],
    ["package.json", "config"],
    [".github/workflows/ci.yml", "config"],
    [".env.example", "config"],
    ["Dockerfile.dev", "config"],
    ["requirements-dev.txt", "config"],
    ["fixtures/events.json", "data"],
    ["exports/claims.csv", "table"],
    ["migrations/0007_delivery_attempts.sql", "database"],
    ["scripts/refresh.sh", "script"],
    ["Makefile", "script"],
    ["pnpm-lock.yaml", "lockfile"],
    ["web/Cargo.lock", "lockfile"],
    ["public/logo.svg", "image"],
    ["fonts/Inter.woff2", "font"],
    ["build/release.tar.gz", "archive"],
  ];
  assert.deepEqual(
    cases.map(([path]) => [path, fileKind(path)]),
    cases,
  );
});

test("the server's image flag wins, and prototype names stay code", () => {
  assert.equal(fileKind("test/fixtures/before.png", true), "image");
  assert.equal(fileKind("docs/screenshot", true), "image");
  for (const path of ["src/constructor", "src/toString", "src/__proto__", "lib/file.constructor"])
    assert.equal(fileKind(path), "code");
});

test("test filtering includes fixtures even when another file kind takes priority", () => {
  assert.equal(isTestFile("test/fixtures/before.png"), true);
  assert.equal(isTestFile("tests/fixture/pnpm-lock.yaml"), true);
  assert.equal(isTestFile("src/latest.ts"), false);
  assert.equal(isTestFile("docs/specs/api.md"), false);
});
