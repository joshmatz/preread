# Reference

## Reviewing

Mark a file **Viewed** to collapse it, or use **Mark all viewed** for a whole group. A group counts as reviewed when all of its files are Viewed, and a review is complete when every group is, including Other changes. The collection view shows progress for every review and rechecks it each time you open it.

Viewed marks belong to the changes you read in a worktree, not to the review they appear in, so they carry over when a review moves to a new base. When a group shows only part of a file, its mark covers just that part, and edits elsewhere in the file leave it alone. When the changes you read are edited, the mark clears and the group needs reading again. Notes stay with the worktree and file, so they carry over too. Marks and notes are saved in your browser. **Mark all viewed** also writes a receipt to disk, so another browser starts from it.

Reviewed is a reading checkpoint. It doesn't approve anything on GitHub, and it isn't permission to push.

## Keeping the page current

Nothing watches your repositories. The Refresh button re-reads the worktree and the collection behind the page you're on and keeps your scroll position, Viewed marks, and open tabs. Agents can trigger the same refresh from the command line. Open pages check for it once a second, and a background tab catches up when you switch back to it:

```sh
pnpm refresh          # re-read every open review page in place
pnpm refresh --page   # reload the browser page itself
```

Importing a collection refreshes open pages on its own. Use `--page` only when Preread itself changed: it reloads the page like the browser's Reload button, so unsaved text in an open dialog is lost. Open pages also reload themselves when the server restarts, so a rebuilt app shows up without a manual reload.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4780` | Server port |
| `PREREAD_DATA_DIR` | `~/.preread` | Where collections and receipts are stored |
| `REVIEW_PATH` | none | Absolute path of a folder to open when Preread loads without a link, like the first argument to `pnpm start` |

Preread used to be called Worktree review. If `~/.worktree-review` exists and `~/.preread` doesn't, Preread keeps reading and writing the old folder; rename it to `~/.preread` to switch. `WORKTREE_REVIEW_DATA_DIR` is no longer read; use `PREREAD_DATA_DIR`.

## Limits

- A repository needs at least one commit.
- A review previews up to 500 files and about 24 MB of patch text, and a single file's diff up to 2 MB. Anything over those limits stays listed with a notice.
- Changed PNG, JPEG, GIF, WebP, AVIF, BMP, and ICO files preview as images up to 20 MB per version. SVG files show as text diffs.
- Binary files such as fonts can be marked Viewed after local inspection. Failed or unavailable oversized previews remain blocked, so their groups stay incomplete.
- Repositories and worktrees nested inside a worktree are left out of its untracked files. Review them on their own.
- Line totals don't count the contents of untracked files.
- The Commits tab shows the latest 100 commits.
- Nothing watches the filesystem. Refresh, or have your agent run `pnpm refresh`, to pick up new commits, edits, or collection changes.
