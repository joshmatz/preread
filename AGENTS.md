# Preread

This is a local, read-only code review application.

Keep repository access read-only: no checkout, staging, commit, reset, fetch, push, or repository-file edits from the application. Use argument-array Git calls, never shell interpolation. Bind the server to loopback and reject cross-origin API requests. Do not load external assets or analytics.

Store collections and review receipts in the app’s own data directory, outside reviewed repositories. Only the person reviewing writes receipts, through the UI.

Use pnpm. Run `pnpm test` and `pnpm build` after functional changes. Check UI changes in both light and dark themes, in your desktop client's in-app browser when it has one.
