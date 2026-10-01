<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/preread-dark.svg">
    <img alt="Preread" src="docs/brand/preread-light.svg" width="300">
  </picture>
</p>

<h3 align="center">Read what your coding agents wrote before it becomes a pull request.</h3>

<p align="center">
  Your agent hands you a reading list: the changes grouped, explained, and in order.<br>
  You read it on your own machine. Preread tracks what's left and reopens anything that changes after you read it.
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#put-your-agent-on-it">Agent skill</a> ·
  <a href="docs/collections.md">Collections</a> ·
  <a href="#your-code-stays-on-your-machine">Privacy</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/review-dark.png">
  <img alt="Preread showing a review titled Retry failed webhook deliveries. The outline lists three described change groups plus Other changes. The first group is marked All viewed and collapsed; the second group's diff is open below it." src="docs/screenshots/review-light.png">
</picture>

## Your agents write faster than you can read

Run a few agents in parallel and you come back to a pile of worktrees, branches, and thousands of changed lines. Reading them as pull requests means pushing code nobody has read yet, one branch at a time, and `git diff` is a wall of text with no story.

A pre-read is the memo you get before a meeting, so you walk in knowing what matters. Preread does that for code: your agent writes the memo, and you read the diff beside it.

## How it works

1. **Your agents work in worktrees.** One agent or ten, in one repository or several. Preread reads any Git checkout, whatever wrote the code.
2. **Your agent writes the reading list.** A collection is a short manifest of reviews. Each names a worktree, the base to compare it with, and change groups that give each part of the diff a title and a note on what to check. The included [agent skill](skills/preread/SKILL.md) teaches your agent to write one and hand you the link.
3. **You read.** Mark files Viewed as you go. A group is reviewed when all of its files are Viewed, and a review is complete when all of its groups are. If the code changes after you've read it, it goes back on your list.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/collection-dark.png">
  <img alt="The collection view for Webhook delivery reliability: a progress bar reading 1 of 3 items reviewed, and a card for each review with its description and reviewed-group count." src="docs/screenshots/collection-light.png">
</picture>

## What makes it different

- **One reading list across worktrees.** A collection spans worktrees and repositories. Each review has its own base, so a stacked branch shows only its own layer.
- **Change groups that say what to check.** Each one pairs files, or single hunks, with a title and a short description. Anything unassigned lands in Other changes, so nothing hides.
- **Progress that follows the code.** A Viewed mark is tied to the diff you read. When that diff changes, the mark clears and its group reopens.
- **Updates on your agent's cue.** After a change, your agent runs `pnpm refresh`, and the page you have open re-reads in place and keeps your scroll position and your marks.
- **Any stage of the work.** Branch commits, branch plus local edits, uncommitted changes, or staged changes.
- **The pull request, once you open one.** Link a review to its GitHub pull request to see its state, checks, and review decision, and whether your local head and base still match it.
- **A diff reader built for long reads.** Unified or split view, syntax highlighting, line wrapping, ignore whitespace, expandable context, before-and-after images, and private notes on any file.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/split-dark.png">
  <img alt="Split view of a stacked review whose base is the retry branch, so it shows only the dashboard layer: a table gains an Attempts column and a RetryBadge cell." src="docs/screenshots/split-light.png">
</picture>

## Quick start

> [!NOTE]
> Preread is software I build for myself, and it may change at any time as the way I work changes. If you depend on it, pin a commit or fork it.

You need Node.js 22.13 or later, pnpm 11, and Git 2.36 or later. Preread is developed on macOS, and the tests also run on Linux; Windows isn't supported. The [GitHub CLI](https://cli.github.com), signed in, is optional and adds pull request status.

Using a coding agent? [Install the skill](#put-your-agent-on-it) and ask for a review; your agent offers to clone and start Preread for you. To set it up by hand:

```sh
git clone https://github.com/joshmatz/preread.git
cd preread
pnpm install
pnpm build
pnpm start
```

Open <http://127.0.0.1:4780>, choose **Open folder**, and enter the absolute path of any repository or worktree. It starts with the branch's commits since your default branch; open the comparison beside the tabs to change the base or include local edits. Choose **Save a named review** to keep it.

Preread is at its best when your agent writes the reading list, so set that up next.

## Put your agent on it

The [`preread` skill](skills/preread/SKILL.md) teaches an agent the whole handoff: plan a collection, choose each base from the real branch ancestry, write and import the manifest, check what every group shows, refresh the page you have open, and hand you the link. It sets Preread up if you haven't, tells you when there's an update, and never marks anything reviewed for you.

Install it for all your projects with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add joshmatz/preread -g
```

Or link it into your agent's skills directory by hand, so it updates with your checkout. For Claude Code, from your Preread checkout:

```sh
mkdir -p ~/.claude/skills && ln -s "$PWD/skills/preread" ~/.claude/skills/preread
```

If you cloned Preread yourself, tell your agent where it lives, for example in your global agent instructions:

```text
Preread is checked out at ~/src/preread. Use the preread skill to present finished work before you push.
```

Now your agent hands you a link when work is ready to read, or whenever you ask it to present something in Preread:

```text
http://127.0.0.1:4780/?collection=webhook-reliability&review=delivery-retries
```

If your agent runs in a desktop app with a built-in browser, such as the Codex or Claude desktop app, it opens the review there too, beside the conversation.

Rather write collections yourself? The [collections guide](docs/collections.md) covers the format.

## Your code stays on your machine

Preread runs where the code is. It only reads your repositories: it never checks out, stages, commits, fetches, or pushes, and it never sends your code anywhere. Apart from Git filling in a partial clone, described below, its only network calls are optional pull request status reads through the GitHub CLI.

- **Read-only Git.** Git runs from argument arrays, never through a shell. Hooks, fsmonitor, external diff tools, and textconv filters are off. Comparisons against the working tree read a private copy of the index, so Preread never writes `.git/index`.
- **Only files in the comparison.** The server reads file contents only for paths in the current comparison. An untracked symlink shows its target path and is never followed. Image previews are sent with a fixed image type under a sandboxing Content Security Policy, and SVG is never rendered, so a preview can't run script.
- **Loopback only.** The server binds to 127.0.0.1. Its API accepts only `127.0.0.1` and `localhost` hosts and rejects requests that come from any other origin, including other local ports, so websites can't read your code through it, even with DNS rebinding. Open pages poll a same-origin refresh counter, which carries no repository content.
- **No third-party requests from the page.** All assets are bundled. There are no fonts, CDNs, or analytics.
- **Data outside your repositories.** Collections and receipts live in `~/.preread` by default, in files only your user can read.

Git still applies a repository's own clean filters when it reads working-tree files, and in a partial clone it may download missing file contents from the remote to build a diff. As with any Git client, open only repositories whose `.git/config` you trust.

## Documentation

- [Collections](docs/collections.md): the manifest format, the CLI, and how imports are checked.
- [Reference](docs/reference.md): reviewing, keeping pages current, configuration, and limits.
- [DESIGN.md](DESIGN.md): the interface decisions.
- [AGENTS.md](AGENTS.md): rules for agents working on this repository.

## Development

```sh
pnpm dev                         # server with Vite middleware and hot reload
pnpm test                        # tests against disposable Git repositories
pnpm build                       # type check and production build
pnpm benchmark <collection-id>   # time opening and checking a collection on the running server
```

## License

[MIT](LICENSE)
