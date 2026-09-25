---
name: worktree-review
description: Present local Git changes for human review in the Worktree review app before anything is pushed. Use when the user asks to review, present, or walk through work in one or more worktrees or branches, asks for a review link or collection, or when finished work should be read before a commit, push, or pull request. Writes a collection manifest with worktree paths, comparison bases, and described change groups, imports it with the app's CLI, checks what each group shows, and hands over a local URL.
---

# Worktree review

Worktree review is a local web app that reads Git worktrees and shows their diffs as collections. A collection is a reading list of reviews. Each review points at a worktree, compares it against a base, and splits the diff into change groups that explain the work. You write the collection; the person reads it and marks it reviewed.

## Find and start the app

1. Find the app checkout. The user's instructions usually say where it is; if they don't, ask. Run every `pnpm` command below from that directory.
2. Check for a running server. The port is `PORT`, 4780 by default.

   ```sh
   curl -sf http://127.0.0.1:4780/api/bootstrap
   ```

3. If nothing answers, build once and start the server as a long-running background process:

   ```sh
   pnpm install && pnpm build
   pnpm start
   ```

Reuse a running server instead of starting another one.

## Plan the collection

A collection is a reading list, not a Git stack. Put related work in one collection, in the order it reads best.

- Read an existing collection before changing it: `pnpm collection list`, then `pnpm collection show <id>`. Import replaces the whole collection, so carry over every review you aren't changing. Keep collection, review, and group IDs stable, because review receipts are keyed by them.
- Choose each base from the real ancestry, not from folder names or collection order. Check it with `git log --oneline --graph <base>..HEAD` and `git merge-base <base> HEAD` inside the worktree. Use the direct parent branch to show one layer of a stack, or the default branch to show everything since it.
- The app never fetches. Make sure the base ref exists locally and contains the commits you expect.
- Pick the mode for what the person should read:
  - `branch`: commits since the merge base with `base`.
  - `all`: those commits plus staged, unstaged, and untracked changes.
  - `working`: HEAD against the working tree.
  - `staged`: HEAD against the index.

## Write the manifest

Write the manifest outside every reviewed repository, for example in a temporary directory.

```json
{
  "id": "search-filters",
  "title": "Saved search filters",
  "description": "Two changes that ship together. Read the API change first; the UI review uses its branch as the base.",
  "reviews": [
    {
      "id": "filters-api",
      "title": "Store saved filters per user",
      "description": "Adds a saved_filters table and CRUD endpoints. Filters are validated on write, so the UI can trust what it reads.",
      "path": "/absolute/path/to/worktree",
      "base": "main",
      "mode": "branch",
      "pullRequest": "https://github.com/owner/repo/pull/123",
      "groups": [
        {
          "id": "schema",
          "title": "Schema and validation",
          "description": "Check the unique index on (user_id, name); the endpoint relies on it to reject duplicates.",
          "targets": [
            { "path": "migrations/0012_saved_filters.sql" },
            {
              "path": "src/filters/validate.ts",
              "ranges": [{ "side": "new", "start": 40, "end": 52 }]
            }
          ]
        }
      ]
    }
  ]
}
```

- IDs use lowercase letters, digits, and hyphens, up to 80 characters. `other-changes` is reserved.
- `path` is the absolute path to the worktree.
- `base` is required for `branch` and `all`. `working` and `staged` compare with HEAD.
- Descriptions say what the change does, why, and what needs the reader's attention. Don't restate the file list.
- Target paths are exact and repository-relative. Omit `ranges` to include the whole file.
- A range uses one-based diff line numbers on the `new` side, or `old` for deleted lines. It selects every complete hunk that has a changed line inside the range; hunks are never split.
- Give each hunk to one group. Anything unassigned appears under Other changes, which is a fine home for incidental edits.
- `pullRequest` is optional. The app reads its status through the user's signed-in `gh` CLI.

## Import and check

```sh
pnpm collection import /absolute/path/to/manifest.json
```

Import rejects unknown fields, empty groups, and paths that aren't repository-relative, and prints the reason. Then check what each group actually contains, without a browser:

```sh
curl -s "http://127.0.0.1:4780/api/review?collection=<collection-id>&review=<review-id>" \
  | jq '.sections[] | {id, files: [.files[].file.path], warnings, canReview}'
```

Fix every warning (a target that left the comparison, a range that matches no change, an overlap with an earlier group) and import again. Ranges drift when lines move, so check again after new commits.

A group with `canReview: false` and no warnings holds a binary file, a diff over the size limit, or a file that failed to load, so it can't be marked reviewed. Tell the person which files to open locally.

## Hand over

Give the person the link to the first review they should read:

```text
http://127.0.0.1:4780/?collection=<collection-id>&review=<review-id>
```

- Never mark anything reviewed for them. Don't call `/api/reviewed`, and don't write files in the app's data directory; use the CLI for collections.
- Reviewed is a reading checkpoint, not permission to commit, push, or open a pull request. Ask for those separately.
