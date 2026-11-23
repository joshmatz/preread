# Overviews

A collection can have a `brief`: a freely authored document above its code reviews. Write the story in the order that helps the reader understand and decide. There are no required sections. A short argument, a visual comparison, and a longer walkthrough can all use the same interaction controls.

The reader sees the collection’s brief as the **Feature overview** and each review’s brief as that part’s overview, labeled **Part N of M**. Manifests, files, and commands keep the name `brief`.

Keep the collection’s `description` short. Put the fuller explanation in `brief.blocks`, mixing Markdown, questions, local visuals, and code excerpts. Block order is reading order. Stable block IDs keep feedback attached to its original context.

To add or update only the brief of an active collection, save `{ "blocks": [...] }` in its own JSON file and run `pnpm collection brief <collection-id> /absolute/path/to/brief.json`. This leaves the collection file, reviews, groups, and review receipts untouched. Briefs live separately under `briefs` in Preread’s data directory, so an agent can keep importing the collection from an older app without overwriting its overview. Full imports with an explicit `brief` update it; imports that omit `brief` preserve it. Older app versions continue reading the original code reviews. If a later group edit removes a linked group, the brief retains its context and reports that the code group is no longer available.

```json
"brief": {
  "blocks": [
    {
      "id": "context",
      "kind": "markdown",
      "markdown": "## A search you can return to\n\nSave **criteria**, then rerun the search against current work.\n\n[Read the ownership query](preread:implementation/ownership)."
    },
    {
      "id": "experience",
      "kind": "visual",
      "visual": {
        "id": "saved-views",
        "title": "Where saved views appear",
        "path": "/absolute/path/to/saved-views.svg",
        "caption": "Illustrative interface with synthetic data."
      }
    },
    {
      "id": "sharing",
      "kind": "question",
      "question": "Who should be able to open a saved filter?",
      "description": "Personal filters avoid introducing sharing permissions in this change.",
      "options": [
        { "id": "personal", "label": "Just its owner", "recommended": true },
        { "id": "team", "label": "Their whole team" }
      ]
    },
    {
      "id": "ownership-check",
      "kind": "code",
      "title": "The ownership condition",
      "language": "typescript",
      "code": "eq(savedFilters.ownerId, userId)",
      "approval": true,
      "reference": {
        "review": "implementation", "group": "ownership",
        "file": { "path": "src/ownership.ts", "start": 4, "end": 4 }
      }
    }
  ]
}
```

The referenced review and group must exist in the same collection. A Markdown link uses `preread:<review-id>/<group-id>` to open a group, or `preread:<review-id>` to open a review: its brief, or its code when it has none. A code block’s `reference` opens the group directly. Include `file` with a repository-relative path and one-based new-side line numbers to display the source location and open that file at the excerpt. The file must belong to the referenced group; when the line is outside its diff, the link opens the file heading. The existing diff reader keeps its Viewed controls and review receipts. A group that an overview links to shows a link back to that place in its header, such as **Part overview: Migrations**.

## Review briefs

Write a brief for every review that ships as its own pull request. The collection brief tells the feature’s story; a review brief tells what this pull request changes: its migrations, changes to behavior people already use, how it fits with the other parts, how it protects data, and why each technical choice beat its alternative. The same [Write for a person](#write-for-a-person) rules apply.

A review brief has exactly the collection brief’s format and limits. Add it to a review in the manifest as `"brief": { "blocks": [...] }`, or write only that review’s brief:

```sh
pnpm collection brief <collection-id> --review <review-id> /absolute/path/to/brief.json
```

That command changes nothing else: not the collection, its groups, its receipts, or any other brief. Each review brief has its own file, `briefs/<collection-id>/<review-id>.json`, beside the collection brief in `briefs/<collection-id>.json`. An import that omits a review’s `brief` keeps the saved one; an import that includes it replaces it. When a review leaves the collection, its brief stays on disk but does not show, and it returns with the review.

Import checks every brief’s code references and visuals the same way, and names the review whose brief failed. A brief can link to any review or group in its collection. Markdown links are checked when the page shows them: a link to a missing review or group shows **Unavailable**.

A review with a brief opens on **Overview**, with **Code** and **Feedback** tabs beside it. When the collection has any overview, a part’s code opens in the same frame: the title, tabs and **Contents** stay in place, and **Changes**, **Commits**, **Git ancestry** and **Find** sit in a toolbar above the diff. Opening a review from the picker, or from a link without a group, file, or line, starts at its brief; links to a group, file, or line open the code there. The picker marks reviews that have a brief. A review brief has every control of the collection brief, with its own feedback and an attention panel for this review’s questions and code. The collection brief’s attention panel also lists unanswered review-brief questions, labeled with the review’s title.

## Contents and code panels

Every overview has a **Contents** rail. It lists the feature overview and every part in collection order, numbered, with each part’s reviewed groups (for example `3/5`) and a **?** while its overview has unanswered questions. Under the open overview, its `##` and `###` headings are the chapters. A chapter shows a **?** for an unanswered question and a count of current comments, and the rail follows the reader’s scrolling. Under the open part, each heading lists the code groups its section links, a group linked from two headings lists under the first, groups no heading links list under **Other code**, and a part without headings lists its groups directly. The rail stays beside the code, where the group being read opens to its files. Below 1180 px wide the rail opens from a **Contents** button.

- Organize an overview with `##` for each journey or decision area and `###` for its subsections; those headings become the contents. Headings inside code fences don’t count.
- Don’t repeat the title as the first heading, and don’t write a table of contents or a “Read the code” list of parts and groups. The rail and the code panels cover both.

Each `##` section that links code groups, through `preread:` links or a code block’s `reference`, ends with a **Code for “<heading>”** panel. It lists each group once with its status, part, file count, and a **Tests** tag when every file is a test. **Mark reviewed** marks every file in that group Viewed, the same as **Mark all viewed** in the code, and writes the same receipt; a reviewed group’s button removes those marks. **Mark N reviewed** does that for the section’s remaining groups. A part overview ends with **Every code group in part N** and links to the previous and next parts.

The feature overview’s attention panel also lists each part’s unanswered questions and unapproved excerpts, and each part where your agent replied, which opens that part’s first item waiting on you, or its first reply in the code when the part has no overview. Its **Feedback** tab lists the parts with open feedback, and **Prepare all feedback** collects what is waiting on your agent in the feature and every part in one batch.

## Composing a brief

Links to code groups and the **Open code group** action show the group’s current read status: **Reviewed**, a partial Viewed count, **Not reviewed**, **Changed since review**, or **Needs attention**. Status follows the same server-owned Viewed marks and content fingerprints as the diff reader, and refreshes when you return from code or the collection refreshes. Loading and failed checks stay distinct from unread code. These indicators never mark a group reviewed, and excerpt approval remains separate. Status updates do not change the text baseline used by passage comments.

Markdown supports headings, paragraphs, emphasis, lists, blockquotes, fenced code, tables, and links. Keep passages short, as [Write for a person](#write-for-a-person) describes. Split prose into stable blocks when the passages have different purposes; there is no need to make every paragraph a block. Text that looks like HTML shows as typed, so a placeholder such as `<name>` stays, and nothing in it runs. Remote Markdown images are replaced with a reminder to import a visual, so authored content cannot load tracking assets.

Visual blocks import PNG, JPEG, WebP, GIF, SVG, or Mermaid files into Preread’s data directory. Use a chart exported to SVG or an image, or a Mermaid diagram, wherever it helps the story. Give illustrative data a clear caption; measured results should name their source and conditions. The original source files remain outside the reviewed repository when they are review-only artifacts. The reader opens a visual in the same full-screen viewer as review visuals, to zoom, pan, and pause or scrub a GIF.

A question has two to eight options, with at most one recommendation. The reader can always write a different answer. A recommendation is suggested, never submitted automatically. Without one, no option starts selected. Answers remain editable. The attention panel lists every unanswered question.

Code fences and excerpts use syntax highlighting for their declared language, with plain text for unsupported languages. An ordinary code fence explains code without asking for approval. Use a code block with `approval: true` when the reader should approve that exact excerpt. Its approval covers the shown text and reference, independently of the group’s Viewed state. Approval is never permission to publish.

### Call trees

A call tree shows what a change runs, one call per line, in the order it runs:

```call-tree
createTodo(input) (the service)
  findAccount(id) (existing)
    -> else not-found "Account not found"
  insertTodo(row) (PR 1 todo-record; changed: also stores the due date)
    insertTodoEvent({ todoId }) (below)
  if todo.assignee: notifyAssignee(todo) (see insertTodo)

insertTodoEvent({ todoId })
  db.insert(todoEvents)
```

Give it the language `call-tree`, on a code block or a fence, and the reader sees an outline. Each step folds the steps under it, notes become labels, and `(below)` and `(see …)` are links that jump to the step they name. The outline opens each tree’s first level, then as many more levels as fit in about 60 lines, plus every step a comment is on. **Text** shows the source with code colors. A comment stays on its passage in either view.

- Indent two spaces per level, and put each step on one line. The outline wraps long lines, so never wrap one by hand. A line at the left margin starts another tree.
- Write calls as code, returns as `-> value`, a branch as `if condition: step`, and a failure as `-> else <code> "<message>"`. Use plain words where code would say less.
- A note is a parenthesis after a space that starts with one of these words. Any other parenthesis stays part of the step.
  - `(existing)`: the code was there before this change.
  - `(changed)`: this change edits it.
  - `(the service)`: the entry point that other code calls.
  - `(PR 5 todo-api)`: another pull request in the stack adds it.
  - `(above)` or `(below)`: the call before the note shows its own steps elsewhere in this tree, in that direction.
  - `(see name)`: the step in this tree that makes the call `name` and shows its steps.
- Add detail after a colon, as in `(changed: also stores the due date)`, and separate notes with `;`, as in `(PR 1 todo-record; changed)`.

## Write for a person

The reader decides from the brief and opens code only to check it. Put the state of the work and the decisions on the first screen.

- Start with where the work stands: what is built and tested, what is pushed, and the steps outside the code, such as keys, vendor settings, templates, or a live test.
- Spend the words where consequences spread: migrations, changes to features people already use, the overall experience, how the parts fit together, and how data is protected. Give each technical decision its reason and the option it beat.
- Let a recording of the real app stand in for a review of interface code, and leave tests out of the brief.
- Give each user journey its own section: two short paragraphs on what changes for the people who use it, then a recording of the real app and at most one diagram. Keep a section under about 150 words.
- End a section with two to four group links on one line. Each link shows a read status, so more links add noise.
- Ask only real decisions as questions. Give each one a recommendation, with its reason in the option. List small choices that are already built under a heading such as "Built this way unless you object".
- Ask in plain words and define any term the reader hasn’t seen. Say what each option changes for the people who use the product. Find what the code, other work, or another person can answer before asking, and say where you looked.
- Decide engineering mechanics yourself. Split pull requests at about 1,000 lines of code each without asking; it is a guide, not a hard limit.
- Show exact text the reader must approve, such as interface copy, as text, grouped by who sees it.
- Write about the product, not the process. Leave out who wrote the brief, which agent made what, and notes that the brief reuses existing material.
- Keep the collection and review `description` to a problem sentence, a solution sentence, and the status. A brief shows its description under its title.

## Comments and revisions

The reader can select text across formatting and blocks, then choose **Comment on selection**, or press **Option+Shift+M**. Each block also has a section comment control, and the whole brief can receive a comment.

Clicking a sidebar annotation opens its editor directly. Comments and replies take Markdown, with fenced code in syntax colors; HTML shows as typed, and an image shows as a link to it. Comments can include up to six PNG, JPEG, WebP, or GIF images, each up to 10 MB. Choose files, paste images, or drop them anywhere on the comment dialog or the dimmed page around it; inspect or remove previews before saving. Image-only comments are allowed. Reopening a comment preserves its attachments. Images are stored in Preread’s own data directory and served only through their saved comment; feedback exports include their absolute local paths so an agent can inspect them.

Comments preserve the selected quote, its offsets, the rendered text baseline, and each block’s content fingerprint. Highlights appear only when the original block and text still match. A changed block retains its old feedback under **Earlier revision**; Preread never silently moves an old approval or annotation onto new content. Changing unrelated prose does not reopen a question or excerpt approval.

Feedback lives under `brief-feedback` in Preread’s data directory, outside repositories, in one folder per brief: `brief-feedback/<collection-id>/` for the collection brief and `brief-feedback/<collection-id>/reviews/<review-id>/` for each review brief. Each entry has its own file, so comments from separate tabs do not overwrite each other. **Prepare feedback** makes one batch of what is waiting on your agent: answers, approved excerpts, quoted comments and, in a review, its comments on code, each with its replies so far and the ID your agent replies to. It does not send messages to a client.

### Replies and resolving

Every answer, approval and comment starts a thread. Your agent replies with `pnpm feedback reply`, and the reply shows under the item on the Feedback tab and, for a comment on code, under the comment on its line, where a notice above the code points to it. Either side resolves: the reader with **Resolve**, the agent by adding `--resolve` to a reply that says what it did. A reply or **Reopen** hands a resolved thread back to the agent. So does changing an answer, or editing an open comment, after the last reply; a resolved comment has to be reopened before it can be edited, and saving without a change keeps the thread as it was. The Feedback tab sorts items into **Waiting on you**, **Waiting on your agent** and a collapsed **Resolved**. **Your agent replied** in the attention panel opens it at the first item waiting on you, and the resolved count under **Your comments** opens **Resolved**. A resolved comment on code folds to one line until the reader shows it. Removing an item removes its replies. Each reply is its own file under `threads/<item-id>/` beside its item, so the agent and an open page never overwrite each other.

Read that same feedback from an agent without marking anything reviewed:

```sh
pnpm feedback <collection-id>
pnpm feedback <collection-id> --all
pnpm feedback <collection-id> --json
pnpm feedback <collection-id> --review <review-id>
pnpm feedback reply <collection-id> <ID> "<reply>" [--resolve]
pnpm feedback reply <collection-id> --file <replies.json>
```

The text output holds only what is waiting on the agent: items with no reply yet, items the reader replied to or reopened, and items changed after the last reply. It starts with the collection brief’s, then each review’s overview feedback and comments on code under its title, each with its ID and the replies so far. The last lines name the reviews with nothing waiting, count what was left out, and show how to reply. `--all` prints every item and labels the resolved ones and those waiting on the reader. **Prepare all feedback** on the feature overview’s Feedback tab makes the same text as the plain command. `--json` keeps the collection brief’s fields at the top level, lists each review with an overview or comments on code under `reviews`, with its comments under `codeComments`, and adds `review` to each feedback entry. Every item has a `replyId` to reply with and a `thread` with its `turn` (`agent`, `person` or `resolved`), `changed` (the reader changed the item after the last reply) and its `events`, and `threads` at the top counts each turn. `--review` prints only that review’s feedback and comments on code.

`pnpm feedback reply` takes the ID as printed. Its ending after the dot marks the reader’s last action on the item, so a reply to an item the reader changed, replied to, resolved or reopened since is refused, and the agent reads the feedback again. The full ID or any unique prefix of at least eight characters also works, without that check. When an ID matches items in more than one place, add `--review <review-id>` or `--feature`. `--resolve` resolves the item with that reply, and `--` before a reply lets it start with `--`. `--file` sends a batch, a JSON array of `{ "id", "body", "resolve"?, "review"?, "feature"? }`, and checks every reply before writing any, so one bad reply writes none. Open pages show new replies within a second.

Comments on code reach an agent too, in every review of a collection, with or without an overview. In the code, the reader clicks a line number to comment on that line, or a file’s comment button to comment on the whole file. Each comment keeps its file, line number, side, the line’s text and its group, under `code-comments/<collection-id>/<review-id>/` in Preread’s data directory. It stays with its line’s text, following the line when edits above move it. When no single line on screen has that text, it moves to the top of its file, marked as not in the diff shown here, with the line it was written on. Comments follow a file into another group or to a new name, and comments on a file that left the review gather at the top of the code. A review’s Feedback tab lists its comments on code with **Show in code**, and Back returns to the Feedback tab. Replies show in both places, and the reader can reply, resolve or reopen in either. Notes written in the browser before comments existed stay there until the reader sends each one as a comment or deletes it.

Give the reader a direct link to the intended entry point:

- `http://127.0.0.1:4780/?collection=<id>&view=brief` for the feature. A collection link without a review also starts at its brief.
- `http://127.0.0.1:4780/?collection=<id>&review=<review-id>&view=brief` for one pull request’s brief. A review link without `view`, a file, or a group anchor also starts at the review’s brief when it has one.
- `http://127.0.0.1:4780/?collection=<id>&review=<review-id>&view=code` for that review’s code. Review links with a file or group anchor open code too.

A supplied link opens where it points, even in a tab that has shown Preread before. Within a tab, links between an overview and its code add a history entry, so the browser’s Back button returns to the exact place the reader left and Forward reopens the other page. After a link from an overview into the code, the top bar also shows **Back to the feature overview** or **Back to part N’s overview**, or **Back to part N’s feedback** after **Show in code** on a Feedback tab. A reload keeps those places. The pickers and tabs replace the current entry instead of adding one.

## Try a complete example

`pnpm brief-demo` creates a disposable Git repository with synthetic changes, imports a sample feature, and prints its manifest, repository, and URL. Set `PREREAD_DATA_DIR` to a temporary directory when recording proof so the synthetic user’s answers and review marks stay separate from real reviews. The script makes no remote Git calls. Remove its generated repository after the demo collection is no longer in use.
