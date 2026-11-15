import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { putCollection } from "../server/collections.ts";
import { origin, requestRefresh } from "../server/live.ts";
import type { Collection } from "../src/review-types.ts";

const directory = await mkdtemp(join(tmpdir(), "preread-brief-demo-"));
const repository = join(directory, "repository");
await mkdir(join(repository, "src"), { recursive: true });
await mkdir(join(repository, "tests"));
const git = (...args: string[]) => execFileSync("git", ["-C", repository, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
  { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" });
git("init", "-b", "main");
await writeFile(join(repository, "src/save-filter.ts"), "export function saveFilter(name, criteria) {\n  return filters.create({ name, criteria });\n}\n");
await writeFile(join(repository, "src/ownership.ts"), "export function findFilter(id, userId) {\n  return db.savedFilters.findFirst({ where: eq(savedFilters.id, id) });\n}\n");
await writeFile(join(repository, "tests/filters.test.ts"), 'test("saves a filter", async () => {\n  assert.ok(await saveFilter("My work", {}));\n});\n');
git("add", ".");
git("-c", "user.name=Preread synthetic user", "-c", "user.email=preread@example.invalid", "commit", "-m", "Synthetic review baseline");
const ownership = "export function findFilter(id, userId) {\n  return db.savedFilters.findFirst({\n    where: and(\n      eq(savedFilters.id, id),\n      eq(savedFilters.ownerId, userId),\n    ),\n  });\n}\n";
await writeFile(join(repository, "src/save-filter.ts"), "export function saveFilter(name, criteria) {\n  const parsed = parseFilter(criteria);\n  return filters.create({\n    name: name.trim(),\n    criteria: parsed,\n    ownerId: currentUser.id,\n  });\n}\n");
await writeFile(join(repository, "src/ownership.ts"), ownership);
await writeFile(join(repository, "tests/filters.test.ts"), 'test("another user cannot open a saved filter", async () => {\n  const filter = await saveAs(alex, "My work");\n  assert.equal((await openAs(sam, filter.id)).status, 404);\n});\n\ntest("reopening uses current matching items", async () => {\n  const filter = await saveAs(alex, "My work");\n  await createMatchingItem();\n  assert.equal((await openAs(alex, filter.id)).items.length, 2);\n});\n');
const asset = (name: string) => fileURLToPath(new URL(`../examples/brief/${name}`, import.meta.url));
const collection: Collection = {
  id: "saved-search-filters-demo", title: "Saved search filters", description: "A useful search you can name, keep, and open again tomorrow. Synthetic demo data.",
  reviews: [{ id: "implementation", title: "Store personal filters", description: "People rebuild the same filters on every visit. Saved criteria give them a live view they can return to.", path: repository, base: "", mode: "working", scope: "groups", groups: [
    { id: "saving", title: "Save the view you already use", description: "Saving keeps the current criteria and a trimmed name. Reopening **runs the search again**, so the results include new matching work.\n\n### What to check\n\n- Saving should preserve the current results.\n- The stored value should describe the criteria, rather than today’s result IDs.", targets: [{ path: "src/save-filter.ts" }] },
    { id: "ownership", title: "Keep the ownership boundary in the query", description: "The owner check belongs in the shared repository query, so opening and deleting a filter enforce the same rule.\n\n**Check the two conditions together:** the record must match both its ID and its owner. This group is separate from the tests, so the behavior and its proof can each be reviewed.", targets: [{ path: "src/ownership.ts" }] },
    { id: "tests", title: "Prove the user-visible boundaries", description: "These cases exercise a different user attempting to open a filter, and a new matching item appearing after a saved search is reopened. They check observable behavior rather than the shape of the query.", targets: [{ path: "tests/filters.test.ts" }] },
  ] }],
  brief: { blocks: [
    { id: "opening", kind: "markdown", markdown: "## A search you can come back to\n\nPeople keep rebuilding the same searches. I want a useful view to be something you can name, keep, and open again tomorrow.\n\nThe saved filter stores **the criteria**. Reopening it runs a fresh search, so new matching work appears automatically. It shouldn’t freeze today’s result list." },
    { id: "experience", kind: "visual", visual: { id: "saved-views", title: "A possible place for saved views", path: asset("saved-views.svg"), caption: "Illustrative mockup with synthetic data. The saved name sits beside search, where you’d return to it." } },
    { id: "repeat-visit", kind: "visual", visual: { id: "task-steps", title: "The next visit takes fewer steps", path: asset("task-steps.svg"), caption: "Illustrative task steps, not measured usage or performance." } },
    { id: "sharing", kind: "question", question: "Who should be able to open a saved filter?", description: "I’d start with personal filters. Team sharing introduces ownership and editing rules we haven’t designed yet.", options: [
      { id: "personal", label: "Just the person who saved it", description: "Start with personal filters; sharing can come later.", recommended: true },
      { id: "team", label: "Anyone on their team", description: "Team members can use it, and its owner controls changes." },
      { id: "workspace", label: "Everyone in the workspace", description: "Make saved views available across teams." },
    ] },
    { id: "ownership-story", kind: "markdown", markdown: "## One boundary I’d like you to inspect\n\nI’ve put the ownership check in the repository query so opening and deleting a saved filter use the same boundary. The excerpt below is the part I’d like you to approve; you can open its group for the surrounding changes." },
    { id: "ownership-excerpt", kind: "code", title: "The ownership condition", language: "typescript", code: ownership.trimEnd(), approval: true, reference: { review: "implementation", group: "ownership", file: { path: "src/ownership.ts", start: 1, end: 8 } } },
    { id: "proof", kind: "markdown", markdown: "The tests cover reopening live criteria and attempts to access another person’s filter. They’re in a separate group so you can read the behavior checks on their own.\n\n[Read the behavior tests](preread:implementation/tests)." },
  ] },
};
const manifest = join(directory, "collection.json");
await writeFile(manifest, JSON.stringify(collection, null, 2) + "\n");
await putCollection(JSON.parse(await readFile(manifest, "utf8")));
await requestRefresh(false).catch(() => false);
console.log(JSON.stringify({ manifest, repository, url: `${origin}/?collection=${collection.id}&view=brief` }, null, 2));
