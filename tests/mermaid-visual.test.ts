import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMermaid } from "../src/mermaid-visual.ts";
test("Mermaid diagrams cannot override reader security settings or load external resources", () => {
  assert.doesNotThrow(() => validateMermaid("flowchart LR\n A[Review] --> B[Gallery]"));
  for (const source of ["%%{init: {'securityLevel':'loose'}}%%\nflowchart LR", "---\nconfig:\n  htmlLabels: true\n---\nflowchart LR",
    'flowchart LR\n A@{img: "https://example.test/a.png"}', 'flowchart LR\n click A "//example.test"',
    'flowchart LR\n click A "javascript:alert(1)"', 'flowchart LR\n A[data:image/png;base64,...]'])
    assert.throws(() => validateMermaid(source), /external resources or configuration/);
  assert.throws(() => validateMermaid("a".repeat(65537)), /too large/);
});
