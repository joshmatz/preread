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
- For a curated task review, use `"scope": "groups"` and assign every intended change to a named group. Only those complete hunks appear in the review, search, progress and line totals. This keeps concurrent and pre-existing work out of the review, including other hunks in shared files. Check each selected hunk: a range includes its entire hunk, which can contain adjacent edits.
- Use `"scope": "comparison"` for an intentional review of the whole comparison. Omitting `scope` retains that behavior for existing collections. Unassigned changes appear under Other changes only in this scope.
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
      "scope": "groups",
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
- Descriptions say what the change does, why, and what needs the reader's attention. Don't restate the file list. Every description renders Markdown.
- Group descriptions have room for paragraphs, examples, headings, and lists. Give each group one behavior or decision; small code selections can need a substantial explanation. Say what to inspect and why it matters. Always put tests in a separate group from the implementation.
- Target paths are exact and repository-relative. Omit `ranges` to include the whole file.
- A range uses one-based diff line numbers on the `new` side, or `old` for deleted lines. It selects every complete hunk that has a changed line inside the range; hunks are never split.
- Give each intended hunk to one group. With group-only scope, anything unassigned is outside the review; verify that no intended change was omitted. With comparison scope, anything unassigned appears under Other changes.
- `pullRequest` is optional. Preread reads its status through the user's signed-in `gh` CLI and shows it under the review's description, on its overview and in its code. The feature overview lists every part's PR.

## Write a feature brief

When the person needs to understand a feature across groups or worktrees, add `brief` to the collection. Read `docs/briefs.md` in the Preread checkout before authoring it. Its `blocks` are an ordered document: mix `markdown`, `question`, `visual`, and `code` blocks wherever they help. Keep block IDs stable. There are no mandatory headings or sections; choose the presentation that best explains this work to this reader. The person sees it as the **Feature overview**, and each review brief as that part’s overview.

When another agent is updating the collection, write the brief as its own `{ "blocks": [...] }` file and use `pnpm collection brief <collection-id> /absolute/path/to/brief.json`. This changes only the separate brief file, preserving the live collection and its groups. Collection imports without an explicit `brief` preserve that overview, including imports from older app versions. Read the latest collection when authoring links; never reimport a stale copy of its reviews just to add an overview.

- Lead with the user’s problem and the resulting experience. Show visual evidence, comparisons, or examples when they help. Keep the short collection description separate from the fuller story.
- Follow its **Write for a person** section: open with the problem as one named example and what changes, not with the state of the work; then one short section per user journey with a recording of the real app; no notes about the process.
- Use `##` for each journey or decision area and `###` for its subsections: these headings are the overview’s **Contents**. Don’t repeat the title as the first heading or write a table of contents or a “Read the code” list; the Contents rail lists every part with its review status, and each section that links code ends with a panel of those groups and a **Mark reviewed** button.
- Ask explicit questions with useful options and, when appropriate, one recommendation. The person can write a custom answer. Never answer questions on their behalf or infer an answer from an idle conversation.
- Ask in plain words, define any term the person hasn’t seen, and say what each option changes for the people who use the product. Look in the code, other sessions, and other people’s work before asking, and say where you looked. Don’t ask engineering mechanics: split pull requests at about 1,000 lines of code each (a guide, not a limit) without asking.
- Use imported local visual blocks for images, charts, and Mermaid diagrams. Label synthetic data and conditions. Markdown does not load remote images or run HTML/scripts.
- Link prose into existing groups with `[label](preread:review-id/group-id)`. A `code` block can also have `reference: { "review": "review-id", "group": "group-id", "file": { "path": "src/example.ts", "start": 10, "end": 18 } }`. Include the actual source location for excerpts from the reviewed code; the file must belong to that group. Code fences and excerpts highlight their declared language. Give a call tree `"language": "call-tree"`, or a `call-tree` fence, and write it as **Call trees** in `docs/briefs.md` describes: two spaces per level, one step per line, and notes such as `(existing)`, `(changed: …)`, `(PR 5 todo-api)`, `(below)` or `(see name)`. Add `approval: true` only when the person should approve that exact excerpt. This is independent of Viewed marks and permission to publish.
- The reader can highlight a passage, comment on a section, or comment on the whole brief. Comments, answers, and approvals stay in Preread’s data directory and retain their original context when the document changes. Do not move or recreate blocks merely to clear feedback.
- Read feedback with `pnpm feedback <collection-id>` or add `--json` for full anchors and revisions, and reply under each item; see [Read and reply to the person's feedback](#read-and-reply-to-the-persons-feedback). It includes the person's comments on code. Inspect attached comment images using their exported local paths. Treat entries marked earlier revision as context to reconcile, rather than approval of the new content. Do not write feedback, answer questions, approve excerpts, or create receipts for the person.

### Write a review brief

Write a brief for every review that ships as its own pull request, in the same format and following the same **Write for a person** rules. Cover what this pull request changes: migrations, changes to behavior people already use, how it fits with the other parts, how data is protected, and the reason for each technical choice. Leave the feature's story to the collection brief.

- Put it on the review in the manifest as `"brief": { "blocks": [...] }`, or write only that review's brief with `pnpm collection brief <collection-id> --review <review-id> /absolute/path/to/brief.json`. That command changes nothing else.
- Link to its own groups, or to any group in the collection, with `preread:review-id/group-id`. `preread:review-id` opens another review: its brief, or its code when it has none.
- `pnpm feedback <collection-id>` prints what is waiting on you in every brief and each review's comments on code, under the review's title; `--review <review-id>` prints one review's, `--all` adds resolved items and those waiting on the person, and `--json` adds the review ID to each entry, lists comments on code under `codeComments`, and gives each item its `thread` and the `replyId` to reply with.

For the feature brief, hand over `http://127.0.0.1:4780/?collection=<id>&view=brief`; for a review brief, `http://127.0.0.1:4780/?collection=<id>&review=<review-id>&view=brief`. The person can enter code from an overview's links, code panels, or **Code** tab, and return through the **Overview** tab or the overview link in each linked group's header. People usually enter from an agent’s link rather than by browsing collections, so choose the link for where they should start. Use a review link when they should start at a specific diff.

## Add visual context

When a diagram or screenshot helps explain a decision, attach it to the review or the relevant group with a `visuals` array: `{ "id": "request-flow", "title": "Request flow", "path": "/absolute/path/diagram.svg", "caption": "Optional explanation." }`. Use stable IDs and descriptive titles. PNG, JPEG, WebP, GIF and SVG up to 10 MB and Mermaid `.mmd` or `.mermaid` source files up to 64 KB are supported, with 12 visuals per scope. Preread copies them into its own local data directory; keep source files outside reviewed repositories when they are review-only artifacts. Reimport the source manifest after revising an image. A compact Visuals button opens a full-screen gallery with zoom, drag and Fit controls; images and Mermaid diagrams stay unloaded until opened. Author titles, groups and attachments through manifests, not the reading UI. Opening a visual is not a Viewed mark for the code.

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

If you imported a collection by mistake, such as a duplicate of one that already covers the work, remove it with `pnpm collection delete <id>`. Delete any other collection only when the person asks. Its review receipts and Viewed marks stay, so importing the same manifest again restores them.

A group with `canReview: false` and no warnings holds a diff over the server size limit or a file that failed to load, so it cannot be marked reviewed. Binary files such as fonts can be marked Viewed after local inspection. Text diffs with at least 500 displayed lines or 100 KB of patch text start collapsed; expand their file heading to read the continuous diff. This does not block Viewed marks.

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

A review with a brief opens on it; to name the start explicitly, hand over `?collection=<collection-id>&review=<review-id>&view=brief` for the brief or `&view=code` for its code.

Before opening the link, check the in-app browser's existing tabs for Preread at the configured host and port; treat `localhost` and `127.0.0.1` as the same local server.

- If any Preread tab is already open, give the link without opening, focusing, or navigating a tab. Import and `pnpm refresh` update open reviews in place; preserve the person's current review, group, scroll position, and active tab.
- If the person explicitly asks to show a particular review, reuse an existing Preread tab and navigate it to that review instead of creating another tab.
- Open a new in-app browser tab only when no Preread tab is open. If you cannot inspect the existing tabs, give the link without opening one.

The API check above already covered what the review shows, so don't screenshot or read the page just to hand it over. Don't launch a standalone browser unless the person asks.

- Never mark anything reviewed for them. Don't call `/api/reviewed`, and don't write files in Preread's data directory; use the CLI for collections.
- Reviewed is a reading checkpoint, not permission to commit, push, or open a pull request. Ask for those separately.

## Read and reply to the person's feedback

The person can comment on any line or file in a collection's reviews, with or without a brief, and answer, approve and comment in a brief. Each of these is a thread you reply to. Read what is waiting on you without marking anything reviewed:

```sh
pnpm feedback <collection-id>
pnpm feedback <collection-id> --review <review-id> --json
```

The output holds only what is waiting on you: new items, items the person replied to or reopened, and items they changed after your last reply, each with its ID and the replies so far. `--all` also prints resolved items and those waiting on the person.

Each comment on code names its file, line and group and quotes the line as the person read it, so check it against the current code before acting. Comments on a file that has since left the review still print; say what became of that file.

Reply under each item with the ID exactly as printed, including its ending after the dot:

```sh
pnpm feedback reply <collection-id> <ID> "Renamed it to openMenu and updated its test." --resolve
pnpm feedback reply <collection-id> <ID> "It shares the query with the list view. Keep it here?"
pnpm feedback reply <collection-id> --file /tmp/replies.json
```

- If the person changed, replied to, resolved or reopened an item after you read it, Preread refuses the reply and sends nothing from that command or batch. Read the feedback again and reply to what is there now.
- An item stays in the output until you reply. Add `--resolve` once the change is made or nothing more is needed, and say in the reply what you did. For an answer or an approval, say how you applied it.
- Leave the item open when you answer a question, ask one, disagree, or haven't finished the work. The person replies or resolves it.
- For several items, write a JSON array of `{ "id", "body", "resolve"? }` outside every repository and pass it with `--file`. Every reply is checked before any is written. When an ID matches items in more than one place, add `"review": "<review-id>"` or `"feature": true` (`--review` or `--feature` on the command line). Feedback from before replies existed counts as waiting on you; resolve what is already handled in one batch.
- The person reads replies in the app within a second. Write each one to them in plain words, without process notes. Replies render Markdown: put names in backticks and code in fenced blocks that name their language.
- Never write, edit or delete the person's comments, answers or approvals, and never reply or reopen as them.
