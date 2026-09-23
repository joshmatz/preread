# Worktree review

A private local review app at `/Users/joshmatz/Projects/joshmatz/worktree-review`. It reads Git without checking out branches, staging, committing, fetching, or pushing. Linked PRs can read their status from GitHub through your signed-in `gh` CLI.

```sh
pnpm install
pnpm dev /absolute/path/to/worktree
# Or use the built version:
pnpm build
pnpm start /absolute/path/to/worktree
```

Open **http://127.0.0.1:4780**. The folder argument is optional. `PORT=4781 pnpm dev` uses a different port. The server binds to loopback, rejects foreign-origin API requests, and bundles all assets locally.

## Reviewing

The compact collection and review selectors replace the all-worktrees sidebar. A collection is a curated reading list, not a Git stack. Each review has its own friendly title, description, worktree path, base, and comparison mode. The Collection tab shows descriptions and current reviewed-group counts for every review, plus collection-wide completion. The review picker shows the same progress. All groups, including Other changes, must be reviewed before an item is complete; changed content reopens it. Items with no changes are labeled separately, and unavailable worktrees never count as complete. Progress is rechecked when opening the collection or refreshing; marking a group updates the current item immediately. Git ancestry remains a separate view of actual branch relationships.

Files appear in one continuous scroll, organized into described change groups. The outline jumps to a file without hiding the others. Diffs render as they approach the viewport. Unified and split views share the same content. Gap controls reveal 20 lines above or below a change; after loading context, **Show all … lines** reveals the remaining unchanged gap. **Reset context** restores the compact diff. Extra context is fetched only on demand, uses the same comparison, and never changes review receipts or includes another group’s changed blocks. Stale worktree content must be refreshed before expansion. The **Ignore whitespace** toggle hides spacing-only changes, preserves line breaks, and remembers your preference in both layouts. Files and groups remain listed, with a notice for whitespace-only blocks; review status and totals still cover the original diff. The Wrap lines toggle applies to both layouts and remembers your preference; split rows stay aligned as their text wraps. Theme-aware pickers provide keyboard navigation and searchable collection/review choices. Light, Dark, and System themes are available; System is the default and follows changes in the OS preference.

- **Branch commits** compares the merge base of the selected base and HEAD against HEAD.
- **Branch + local edits** includes committed, staged, unstaged, and untracked changes since that merge base.
- **Uncommitted changes** compares HEAD with the working tree.
- **Staged changes** compares HEAD with the index.

Choose the actual parent branch to inspect one layer, or the development branch to inspect cumulative changes. Verify that the chosen base has the intended local commit; the app never fetches automatically. Editing comparison controls opens an ad hoc comparison and leaves the saved review configuration untouched.

A review can link to a GitHub PR through **Edit review details → Pull request URL** or the optional `pullRequest` manifest field. Links and draft/open/merged/closed status appear in the review header and collection. The header also shows checks, GitHub review status, and whether the local head/base match the PR. Local reviewed-group receipts remain independent of GitHub approval. PR reads run separately from diffs with two background workers, a 60-second cache, and request coalescing. **Refresh PR status** bypasses the cache; failed refreshes clearly retain the last known status. No GitHub writes or automatic Git fetches occur.

Use **Save a named review** for an ad hoc comparison. Names and descriptions can be edited with the pencil controls. **Add change group** assigns whole files; agents can assign individual change blocks through the manifest below. Unassigned files and blocks always appear under **Other changes**.

A group is reviewed when all of its current files (or selected blocks) are Viewed. The outline, review picker, and collection completion all derive from those same marks, including existing marks saved in the browser. **Mark all viewed** checks and collapses every file in the group; **All viewed** clears those marks. Individual file buttons stay available, so unchecking one immediately reopens the group. Changed file content needs viewing again. Unavailable previews or unmatched assignments still block completion. Reviewed is a reading checkpoint, never permission to publish.

File Viewed marks are browser-local and synchronize between tabs on the same origin. Bulk group marks also retain the existing disk receipt as a default for other browsers; an explicit file mark in this browser takes precedence. Collection status reads compact file identities to include these browser-local marks, without fetching every diff or writing review receipts automatically.

Click a file’s chevron or name to collapse or expand it. Marking a file Viewed collapses it and dims its outline entry; clearing Viewed reopens it. You can expand a viewed file without clearing its mark. Viewed and collapse states persist across refreshes in this browser and reset when that file’s diff changes. Individual Viewed buttons and private file notes are browser-local. Bulk receipts and collection descriptions are on disk; browser file marks survive browser/server restarts. Repository files are never changed by the application.

## Agent workflow and manifest

Create or update a collection with the CLI, preserving stable collection/review/group IDs so existing review receipts remain useful. Read an existing collection before editing; import replaces that collection’s configuration, but preserves the separate user review receipts. Do not mark real work reviewed on Josh’s behalf.

```sh
pnpm collection list
pnpm collection show copilot-tools
pnpm collection import /absolute/path/to/manifest.json
```

The import command prints a local URL. To present a specific review, use `http://127.0.0.1:4780/?collection=copilot-tools&review=nested-groups`. Raw comparisons still support `?path=<encoded-absolute-path>&base=<encoded-ref>&mode=branch`. A `file` parameter jumps to that file. Copy link also preserves an outline anchor.

```json
{
  "id": "example-collection",
  "title": "Claim reporting decisions",
  "description": "Related changes to review together; each has its own base.",
  "reviews": [
    {
      "id": "status-reason",
      "title": "Group claims by Status Reason",
      "description": "Explain the behavior, reason for the change, and practical impact.",
      "path": "/absolute/path/to/worktree",
      "base": "codex/actual-parent-branch",
      "mode": "branch",
      "pullRequest": "https://github.com/owner/repo/pull/123",
      "groups": [
        {
          "id": "projection",
          "title": "Add the search projection",
          "description": "Explain this decision and what needs attention.",
          "targets": [
            { "path": "src/index-config.ts" },
            {
              "path": "src/shared-file.ts",
              "ranges": [{ "side": "new", "start": 40, "end": 52 }]
            }
          ]
        }
      ]
    }
  ]
}
```

File paths are exact and repository-relative. Omit `ranges` to include the whole file. Ranges use one-based old/new diff line numbers and select every complete Git change block (hunk) containing a changed line in that range, including its context. Use `old` for deleted lines. This deliberately does not split a replacement halfway through. Check the rendered selection after assigning ranges; moved lines may need updated ranges. Give each block one group; overlapping assignments produce an explicit warning. Unmatched ranges leave the diff in Other changes rather than hiding it.

The app stores collection manifests in `~/.worktree-review/collections/` and user review receipts in `~/.worktree-review/reviews/`. `WORKTREE_REVIEW_DATA_DIR` overrides that directory for isolated tests. Use the CLI for configuration; leave receipt files to the UI. Metadata stays outside reviewed repositories.

## Limits and validation

An existing repository needs at least one commit. Diffs over 2 MB receive an explicit notice. A review previews at most 500 files and roughly 24 MB of patch text; remaining files stay listed with an unavailable-preview message. Tracked line totals exclude untracked-file contents. Commit history shows the latest 100 commits. Refresh explicitly to load filesystem changes or agent updates to a collection.

`pnpm test` uses disposable Git repositories for merge-base behavior, staged/unstaged separation, renames, symlink boundaries, literal filenames, repository/index immutability, partial-file grouping, review persistence, and stale-mark rejection. `pnpm build` checks TypeScript and builds the UI. Use the Codex in-app browser for visual checks.

## Measuring local performance

Run `pnpm benchmark <collection-id>` against the running server to measure opening its first review, checking every item with two background workers, and repeating those reads. Restart the server first for a cold first-open measurement. The benchmark only reads existing work and never marks anything reviewed. Browser rendering should also be checked in the in-app browser.

Branch reviews share bounded in-memory Git content keyed by resolved HEAD and base commit IDs. Each request rechecks those refs and reads current group descriptions and receipts, so new commits, changed bases, and review decisions remain visible. Mutable working-tree and staged comparisons are reread. Patch reads are batched, and review navigation does not wait for repository metadata or the collection's background status checks.
