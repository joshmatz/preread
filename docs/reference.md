# Reference

## Reviewing

Mark a file **Viewed** to collapse it, or use **Mark all viewed** for a whole group. Once a group's header scrolls away, a bar at the top keeps the group's name and **Mark all viewed**, which folds the group and moves on to the next one. **Mark review viewed** beside the review's title marks every group left in it; in a collection with an overview, the top bar carries it as **Mark part viewed**. The collection page marks the whole collection. A group counts as reviewed when all of its files are Viewed, and a review is complete when every group is, including Other changes. The collection view shows progress for every review and rechecks it each time you open it.

Viewed marks belong to the changes you read in a worktree, not to the review they appear in, so they carry over when a review moves to a new base. When a group shows only part of a file, its mark covers just that part, and edits elsewhere in the file leave it alone. When the changes you read are edited, the mark clears and the group needs reading again. Marks are saved in Preread’s data directory, so every browser using the server shares them. **Mark all viewed** also writes a receipt to disk, so another browser starts from it.

Reviewed is a reading checkpoint. It doesn't approve anything on GitHub, and it isn't permission to push.

## Following code

In a JavaScript or TypeScript file, ⌘-click a name to open where it's defined (Ctrl-click off a Mac): a call, a constant, a type, a component, a prop, or a property. Holding the key underlines what you can follow. A name with no definition, or one clicked where it's declared, says so instead. A call into an installed package opens the package's source, with its name and version beside the path.

Definitions open in a full-window source viewer of the worktree as the review shows it. A changed file shows as one whole-file diff in your layout and whitespace settings, and an unchanged file shows plain source. **Collapse removed lines** folds each run of removed lines into one row, so the file reads as it is now: click a row to show its lines, and the viewer remembers the choice. A file card's **Open in the source viewer** button opens its file at the change you were reading. The Explorer beside the code is the whole worktree, with changed folders colored and counted.

- ⌘F finds text in the open file. Enter and ⇧Enter, or ⌘G and ⇧⌘G, step through the matches, and the search carries to the next file you open.
- ⌘[ and ⌘] go back and forward through the places you opened.
- **Open in VS Code**, Cursor, or Zed, or **Reveal in Finder**, shows while the file on disk matches what the viewer shows.

## Comments for your agent

In a review that belongs to a collection, click a line number to comment on that line, or a file’s comment button to comment on the whole file. ⌘↩ saves, and Esc closes a comment you haven’t written yet. A comment you haven’t saved survives a reload of the tab. Comments are saved in Preread’s data directory: your agent reads them with `pnpm feedback`, and a review with an overview lists them on its Feedback tab, where **Show in code** opens the comment’s line.

Comments and replies take Markdown. Wrap a name in backticks to show it as code, or fence a block with three backticks and its language for syntax colors; a block that names no language takes the language of the file it’s on. Lists, links, quotes and tables work too. Text that looks like HTML, such as `Promise<void>`, shows as you typed it, and an image shows as a link to it.

Your agent replies under a comment, and a notice above the code says how many comments have a reply waiting for you, with **Show it** or **Show next** to jump there. **Reply** to answer back, or **Resolve** once it’s settled; your agent can resolve too, with a reply that says what it did. A resolved comment folds to one line, and **Reopen** or a reply hands it back to your agent. Editing a comment after a reply does the same. Removing a comment removes its replies.

A comment stays with its line’s text, so it follows the line when edits above move it. When no single line in the diff has that text, the comment moves to the top of its file with the line it was written on. Comments follow a file into another group or to a new name. Comments on a file that left the review gather at the top of the code under **Comments on files no longer in this review**. While a file shows only its changes since you viewed it, you can comment on its current lines but not on removed ones.

Private notes from earlier versions show at the top of their file until you send each one as a comment or delete it.

## Keeping the page current

Nothing watches your repositories. The Refresh button re-reads the worktree and the collection behind the page you're on and keeps your scroll position, Viewed marks, and open tabs. Agents can trigger the same refresh from the command line. Open pages check for it once a second, and a background tab catches up when you switch back to it:

```sh
pnpm refresh          # re-read every open review page in place
pnpm refresh --page   # reload the browser page itself
```

Importing or deleting a collection refreshes open pages on its own. Use `--page` only when Preread itself changed: it reloads the page like the browser's Reload button, so unsaved text in an open dialog is lost. Open pages also reload themselves when the server restarts, so a rebuilt app shows up without a manual reload.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4780` | Server port |
| `PREREAD_DATA_DIR` | `~/.preread` | Where collections, receipts, Viewed marks, feedback, and comments are stored |
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
