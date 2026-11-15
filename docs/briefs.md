# Feature briefs

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

A review with a brief opens on **Overview**, with **Code** and **Feedback** tabs beside it, and its code view shows the same tabs above the diff. Opening a review from the picker, or from a link without a group, file, or line, starts at its brief; links to a group, file, or line open the code there. The picker marks reviews that have a brief. A review brief has every control of the collection brief, with its own feedback and an attention panel for this review’s questions and code. The collection brief’s attention panel also lists unanswered review-brief questions, labeled with the review’s title.

## Contents and code panels

Every overview has a **Contents** rail. It lists the feature overview and every part in collection order, numbered, with each part’s reviewed groups (for example `3/5`) and a **?** while its overview has unanswered questions. Under the open overview, its `##` and `###` headings are the chapters. A chapter shows a **?** for an unanswered question and a count of current comments, and the rail follows the reader’s scrolling. Below 1180 px wide the rail opens from a **Contents** button.

- Organize an overview with `##` for each journey or decision area and `###` for its subsections; those headings become the contents. Headings inside code fences don’t count.
- Don’t repeat the title as the first heading, and don’t write a table of contents or a “Read the code” list of parts and groups. The rail and the code panels cover both.

Each `##` section that links code groups, through `preread:` links or a code block’s `reference`, ends with a **Code for “<heading>”** panel. It lists each group once with its status, part, file count, and a **Tests** tag when every file is a test. **Mark reviewed** marks every file in that group Viewed, the same as **Mark all viewed** in the code, and writes the same receipt; a reviewed group’s button removes those marks. **Mark N reviewed** does that for the section’s remaining groups. A part overview ends with **Every code group in part N** and links to the previous and next parts.

The feature overview’s attention panel also lists each part’s unanswered questions and unapproved excerpts. Its **Feedback** tab lists the parts that have feedback, and **Prepare all feedback** collects the feature’s and every part’s feedback in one batch.

## Composing a brief

Links to code groups and the **Open code group** action show the group’s current read status: **Reviewed**, a partial Viewed count, **Not reviewed**, **Changed since review**, or **Needs attention**. Status follows the same server-owned Viewed marks and content fingerprints as the diff reader, and refreshes when you return from code or the collection refreshes. Loading and failed checks stay distinct from unread code. These indicators never mark a group reviewed, and excerpt approval remains separate. Status updates do not change the text baseline used by passage comments.

Markdown supports headings, paragraphs, emphasis, lists, blockquotes, fenced code, tables, and links. Keep passages short, as [Write for a person](#write-for-a-person) describes. Split prose into stable blocks when the passages have different purposes; there is no need to make every paragraph a block. Raw HTML and scripts are omitted. Remote Markdown images are replaced with a reminder to import a visual, so authored content cannot load tracking assets.

Visual blocks import PNG, JPEG, WebP, GIF, SVG, or Mermaid files into Preread’s data directory. Use a chart exported to SVG or an image, or a Mermaid diagram, wherever it helps the story. Give illustrative data a clear caption; measured results should name their source and conditions. The original source files remain outside the reviewed repository when they are review-only artifacts.

A question has two to eight options, with at most one recommendation. The reader can always write a different answer. A recommendation is suggested, never submitted automatically. Without one, no option starts selected. Answers remain editable. The attention panel lists every unanswered question.

Code fences and excerpts use syntax highlighting for their declared language, with plain text for unsupported languages. An ordinary code fence explains code without asking for approval. Use a code block with `approval: true` when the reader should approve that exact excerpt. Its approval covers the shown text and reference, independently of the group’s Viewed state. Approval is never permission to publish.

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

Clicking a sidebar annotation opens its editor directly. Comments can include up to six PNG, JPEG, WebP, or GIF images, each up to 10 MB. Choose files, paste images, or drop them into the editor; inspect or remove previews before saving. Image-only comments are allowed. Reopening a comment preserves its attachments. Images are stored in Preread’s own data directory and served only through their saved comment; feedback exports include their absolute local paths so an agent can inspect them.

Comments preserve the selected quote, its offsets, the rendered text baseline, and each block’s content fingerprint. Highlights appear only when the original block and text still match. A changed block retains its old feedback under **Earlier revision**; Preread never silently moves an old approval or annotation onto new content. Changing unrelated prose does not reopen a question or excerpt approval.

Feedback lives under `brief-feedback` in Preread’s data directory, outside repositories, in one folder per brief: `brief-feedback/<collection-id>/` for the collection brief and `brief-feedback/<collection-id>/reviews/<review-id>/` for each review brief. Each entry has its own file, so comments from separate tabs do not overwrite each other. **Prepare feedback** makes one batch with questions, answers, approved excerpts, and quoted comments. It does not send messages to a client.

Read that same feedback from an agent without marking anything reviewed:

```sh
pnpm feedback <collection-id>
pnpm feedback <collection-id> --json
pnpm feedback <collection-id> --review <review-id>
```

The text output starts with the collection brief’s feedback, then each review brief’s under its review’s title. Review briefs without feedback are named together on the last line, so a long collection’s batch holds only what needs action. **Prepare all feedback** on the feature overview’s Feedback tab makes this same text. `--json` keeps the collection brief’s fields at the top level, lists review briefs under `reviews`, and adds `review` to each of their entries. `--review` prints only that review’s brief.

Give the reader a direct link to the intended entry point:

- `http://127.0.0.1:4780/?collection=<id>&view=brief` for the feature. A collection link without a review also starts at its brief.
- `http://127.0.0.1:4780/?collection=<id>&review=<review-id>&view=brief` for one pull request’s brief. A review link without `view`, a file, or a group anchor also starts at the review’s brief when it has one.
- `http://127.0.0.1:4780/?collection=<id>&review=<review-id>&view=code` for that review’s code. Review links with a file or group anchor open code too.

Navigation history does not override the supplied link.

## Try a complete example

`pnpm brief-demo` creates a disposable Git repository with synthetic changes, imports a sample feature, and prints its manifest, repository, and URL. Set `PREREAD_DATA_DIR` to a temporary directory when recording proof so the synthetic user’s answers and review marks stay separate from real reviews. The script makes no remote Git calls. Remove its generated repository after the demo collection is no longer in use.
