# Worktree review

This is a local, read-only code review application. Do not create or update pull requests, push commits, or publish anything without Josh's explicit approval. Exploring and testing authorizes local work only.

Store collection descriptions and user review receipts in the app’s own data directory, outside reviewed repositories. Do not mark real work reviewed on Josh’s behalf.

Keep repository access read-only: no checkout, staging, commit, reset, fetch, push, or repository-file edits from the application. Use argument-array Git calls, never shell interpolation. Bind the server to loopback and reject cross-origin API requests. Do not load external assets or analytics.

Use pnpm. Run `pnpm test` and `pnpm build` after functional changes. Use the Codex in-app browser for visual checks.
