---
name: preread
description: Present local Git changes for human review in Preread before anything is pushed. Use when the user asks to review, present, or walk through work in one or more worktrees or branches, asks for a review link or collection, when finished work should be read before a commit, push, or pull request, or when a worktree already under review changed and the open review page should catch up. Writes a collection manifest with worktree paths, comparison bases, and described change groups, imports it with Preread's CLI, checks what each group shows, refreshes the open page, and hands over a local URL. If Preread isn't set up yet, offers to clone and start it.
---

# Preread

Preread is a local web app that reads Git worktrees and shows their diffs as collections. A collection is a reading list of reviews. Each review points at a worktree, compares it against a base, and splits the diff into change groups that explain the work. You write the collection; the person reads it and marks it reviewed.

## Find and start Preread

Preread runs from a local checkout of [joshmatz/preread](https://github.com/joshmatz/preread). Run every `pnpm` command below from that checkout.

1. Find the checkout. The user's instructions may say where it is. If they don't, ask the running server, which also tells you whether one is up. The port is `PORT`, 4780 by default.

   ```sh
   curl -sf http://127.0.0.1:4780/api/bootstrap | jq -r '.checkout // empty'
   ```

2. If neither turns one up, offer to clone it. Suggest a folder beside the user's other repositories, and use whichever they choose:

   ```sh
   git clone https://github.com/joshmatz/preread.git <folder>
   ```

   Preread needs Node.js 22.13 or later, pnpm 11, and Git 2.36 or later. If any is missing, tell the user instead of installing it. After cloning, offer to add the path to the user's agent instructions so later sessions find it.

3. If no server answered, build once and start the server as a long-running background process:

   ```sh
   pnpm install && pnpm build
   pnpm start
   ```

Reuse a running server instead of starting another one.

## Check for updates

Preread changes often. The first time you use it in a session, check from the checkout whether it's behind:

```sh
git fetch --quiet && git log --oneline HEAD..@{upstream}
```

If the fetch fails or the checkout has no upstream, skip this without comment. If commits are listed, tell the user how many and what they change, then offer to update. Update only once they agree:

```sh
git pull --ff-only && pnpm install && pnpm build
```

If the pull stops on local changes, show them to the user rather than discarding them. Restart a running server afterward by stopping the process on the port and running `pnpm start` again; open pages reload themselves. Then reread `skills/preread/SKILL.md` in the checkout, which matches the version you just installed. If this skill was installed with the skills CLI, offer to run `npx skills update preread -g` too, so later sessions get the new instructions.

## Plan the collection

A collection is a reading list, not a Git stack. Put related work in one collection, in the order it reads best.

- Read an existing collection before changing it: `pnpm collection list`, then `pnpm collection show <id>`. Import replaces the whole collection, so carry over every review you aren't changing. Keep collection, review, and group IDs stable, because review receipts are keyed by them. A receipt also covers the group's title, description, and targets and the review's path, base, and mode, so change those only when the reader should look again.
- Choose each base from the real ancestry, not from folder names or collection order. Check it with `git log --oneline --graph <base>..HEAD` and `git merge-base <base> HEAD` inside the worktree. Use the direct parent branch to show one layer of a stack, or the default branch to show everything since it.
- Preread never fetches. Make sure the base ref exists locally and contains the commits you expect.
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

- IDs use lowercase letters, digits, and hyphens, up to 80 characters. `other-changes` is reserved for group IDs.
- `path` is the absolute path to the worktree.
- Every review needs a `base`. `branch` and `all` need a real ref; `working` and `staged` compare with HEAD, so give them `""`.
- Descriptions say what the change does, why, and what needs the reader's attention. Don't restate the file list.
- Target paths are exact and repository-relative. Omit `ranges` to include the whole file.
- A range uses one-based diff line numbers on the `new` side, or `old` for deleted lines. It selects every complete hunk that has a changed line inside the range; hunks are never split.
- Give each hunk to one group. Anything unassigned appears under Other changes, which is a fine home for incidental edits.
- `pullRequest` is optional. Preread reads its status through the user's signed-in `gh` CLI.

## Import and check

```sh
pnpm collection import /absolute/path/to/manifest.json
```

Import rejects unknown fields, empty groups, and paths that aren't repository-relative, and prints the reason. A successful import also refreshes every open review page in place. Then check what each group actually contains, without a browser:

```sh
curl -s "http://127.0.0.1:4780/api/review?collection=<collection-id>&review=<review-id>" \
  | jq '.sections[] | {id, files: [.files[].file.path], warnings, canReview}'
```

Fix every warning (a target that left the comparison, a range that matches no change, an overlap with an earlier group) and import again. Ranges drift when lines move, so check again after new commits.

A group with `canReview: false` and no warnings holds a binary file that can't be previewed as an image, a diff over the size limit, or a file that failed to load, so it can't be marked reviewed. Tell the person which files to open locally.

## Keep the page current

Nothing watches the filesystem. After anything that changes what a review shows, such as new commits, edits, or a rebase in a reviewed worktree, run:

```sh
pnpm refresh
```

Within a second, every open review page re-reads its collection and worktree in place and keeps the reader's scroll position and Viewed marks. A background tab catches up when the person switches back to it. Import does this on its own. The command can't tell whether any page is open, so still hand over the link.

`pnpm refresh --page` reloads the browser page itself. Use it only when Preread's own code changed or the person says the page looks stale, because it drops unsaved text in an open dialog. After you restart the server, open pages reload themselves.

## Hand over

Give the person the link to the first review they should read:

```text
http://127.0.0.1:4780/?collection=<collection-id>&review=<review-id>
```

If your client has an in-app browser, such as the Codex or Claude desktop app's, also open the link there so the review sits beside the conversation. Opening it is the whole step: the API check above already covered what it shows, so don't screenshot or read the page. Don't launch a standalone browser unless the person asks.

- Never mark anything reviewed for them. Don't call `/api/reviewed`, and don't write files in Preread's data directory; use the CLI for collections.
- Reviewed is a reading checkpoint, not permission to commit, push, or open a pull request. Ask for those separately.
