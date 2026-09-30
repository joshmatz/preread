# Collections

A collection is a reading list: one or more reviews, each pointing at a worktree and the base to compare it with, and each diff split into change groups that explain it. Your agent usually writes it with the [`preread` skill](../skills/preread/SKILL.md), but it's plain JSON you can write yourself.

## Import and open

Run these from your Preread checkout. Import prints a link to the first review:

```sh
pnpm collection import /absolute/path/to/manifest.json
pnpm collection list
pnpm collection show <collection-id>
```

Open any review directly at `http://127.0.0.1:4780/?collection=<collection-id>&review=<review-id>`.

## Manifest

```json
{
  "id": "webhook-reliability",
  "title": "Webhook delivery reliability",
  "description": "Three changes planned for the next release. Read them in order.",
  "reviews": [
    {
      "id": "delivery-retries",
      "title": "Retry failed webhook deliveries",
      "description": "Failed deliveries now retry with exponential backoff instead of failing on the first error.",
      "path": "/Users/you/src/courier-retries",
      "base": "main",
      "mode": "branch",
      "pullRequest": "https://github.com/owner/repo/pull/142",
      "groups": [
        {
          "id": "backoff-policy",
          "title": "Backoff policy",
          "description": "A pure function decides when to try again. Check the jitter bounds and the 30-minute cap.",
          "targets": [{ "path": "src/delivery/backoff.ts" }, { "path": "test/backoff.test.ts" }]
        },
        {
          "id": "delivery-worker",
          "title": "Delivery worker",
          "description": "Records every attempt and schedules the next one.",
          "targets": [
            {
              "path": "src/delivery/worker.ts",
              "ranges": [{ "side": "new", "start": 40, "end": 52 }]
            }
          ]
        }
      ]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Lowercase letters, digits, and hyphens, up to 80 characters. Keep IDs stable, because review receipts are keyed by them. `other-changes` is reserved for group IDs. |
| `path` | Absolute path to the worktree or repository. |
| `base` | Any ref Git can resolve locally. `branch` and `all` compare against it. `working` and `staged` compare with HEAD and ignore it, but the field is still required, so use `""`. Preread never fetches, so make sure the ref has the commits you expect. |
| `mode` | `branch` compares the merge base of `base` and HEAD with HEAD. `all` adds staged, unstaged, and untracked changes. `working` compares HEAD with the working tree, including untracked files. `staged` compares HEAD with the index. |
| `pullRequest` | Optional GitHub pull request URL. |
| `targets[].path` | Exact, repository-relative file path. |
| `targets[].ranges` | Optional. One-based diff line numbers on the `new` side, or `old` for deleted lines. A range selects every complete hunk with a changed line inside it; hunks are never split. |

## How imports are checked

Import rejects unknown fields, empty groups, and paths that aren't repository-relative, so a typo fails instead of importing a group that shows nothing. It replaces a collection's configuration and keeps its review receipts. A receipt covers a group's title, description, targets, and diff, and its review's path, base, and mode; when any of them changes, the group shows Changed since review and needs another read.

Every changed hunk shows up somewhere: in the group that claims it, or under Other changes. A target that no longer matches the diff gets a warning, and so does a hunk claimed by two groups.

Editing a comparison in the UI opens an ad hoc view and leaves the saved review alone.
