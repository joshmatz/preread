---
name: preread-images
description: Show what a change looks like in Preread by attaching images to a collection, review, or change group. Captures a screenshot of the changed UI rendered from the worktree, exports a Figma frame, pairs before and after, or renders a diagram, then adds the files to the collection manifest. Use when the person asks to see a change, asks what something looks like, or wants a screenshot, design, or diagram attached to a review. Optional companion to the preread skill, which covers writing and importing collections.
---

# Preread images

Preread shows images under the description of a collection, a review, or a change group, and opens them full size on click. Preread never loads anything from another site, so it can't embed a live tool such as Figma. Attach a still image instead, and link to the live source.

Capture images only when the person asks to see a change, or their instructions say to. Each capture costs time and tokens, so don't add them by default.

## Pick a source

Prefer a picture of the change itself over a design of it: it shows exactly what the code does.

1. **The component, rendered from the worktree.** For a UI change, render the changed component with sample data in the project's component workbench, such as Storybook, and screenshot it headlessly. If no story shows the state you need, write a throwaway one (see below).
2. **The running app.** If a dev server for the worktree is already running, or starts without extra services, capture the page with headless Playwright. If the page needs a sign-in, ask the person to sign in once in a headed window that saves Playwright storage state. Never type their credentials.
3. **A design.** When the change implements a design, attach the frame beside the result so the reader can compare them. With the Figma MCP server, `get_screenshot` takes the file key and node ID from the frame's URL and returns an image; save it as a PNG and set `link` to the frame's URL.
4. **Before and after.** Capture the base the same way from a temporary worktree at the review's base: `git worktree add --detach <scratch folder> <base>`, then install its dependencies. Caption the pair "Before" and "After", and remove the worktree with `git worktree remove` when you're done.
5. **A diagram.** For a flow, state machine, or architecture change, render a diagram to PNG with any tool you have, such as the Mermaid CLI, Graphviz, or a headless screenshot of an HTML page.
6. **Anything else.** Any tool that writes a PNG, JPEG, GIF, WebP, AVIF, BMP, or ICO file works. An animated GIF or WebP can show an interaction. Use `link` for anything the reader can open live: a Figma file, a Storybook story, a staging page.

## Capture

- Leave the reviewed worktree as it is. Put scratch stories, scripts, and output outside tracked files, and check that `git status --short` in the worktree is unchanged when you're done.
- Use made-up sample data. Never capture real customer or patient data, secrets, or tokens.
- Capture headlessly. Don't drive an interactive browser to take screenshots.
- Crop to the part that changed, with a little padding. A device scale factor of 2 keeps text sharp; keep each file under a few MB.
- Look at each image once to confirm it shows what its caption says: no error overlay, loading state, or missing fonts.
- Stop every server you started, by its process ID.

### A throwaway story

When the project has Storybook but no story for the state you need, render one without touching tracked files:

1. Make a folder under the worktree's `node_modules/.cache/`, which Git ignores, so the story's imports resolve through the project's `node_modules`. Note whether `.cache` already existed.
2. In it, write a Storybook config folder. Its `main.ts` imports the project's `.storybook/main.ts` config and overrides `stories` with your story's absolute path. Override any path the original resolves against its own folder too, such as `staticDirs`. Its `preview.tsx` re-exports the project's preview, so the story gets the same theme and providers.
3. With the Vite builder, Storybook looks for `vite.config.*` in the parent of the config folder, so it no longer finds the project's. In your `viteFinal`, call the project's `viteFinal`, add the plugins the project's Vite config adds (such as its React and SVG plugins), and set Vite's `cacheDir` inside your folder.
4. Write the story with sample data, composed the way the app composes the component: the same table, card, or page around it. If the component needs a router or a data client, reuse the decorators the project's own stories use.
5. Run Storybook from the worktree on a free port, on loopback, with its cache in your folder: `CACHE_DIR=<your folder>/cache STORYBOOK_DISABLE_TELEMETRY=1 storybook dev --ci --no-open --host 127.0.0.1 -p <port> -c <your config folder>`.
6. With Playwright, open `http://127.0.0.1:<port>/iframe.html?id=<story-id>&viewMode=story`, wait for the network to go idle and for `document.fonts.ready`, and screenshot the rendered element. The first load can stall while Vite optimizes dependencies; reload once if it does.
7. Stop Storybook by its process ID, delete your folder, and remove `node_modules/.cache` if you created it.

## Attach

Add `images` wherever the reader needs the picture: on a group for one component, on the review for the overall result, or on the collection for something that spans reviews.

```json
"images": [
  {
    "path": "/tmp/shots/transactions.png",
    "caption": "Transactions table with a check's reference number and notes. Storybook render from the worktree with sample data.",
    "link": "https://www.figma.com/design/<file-key>/<name>?node-id=1-2"
  }
]
```

- `path` is absolute. Import copies the file into Preread's data directory, so you can delete your copy afterward.
- `caption` says in a sentence what the reader is looking at and where it came from: a Storybook render, the running app, a Figma frame.
- `link` is optional: an http or https URL for the live source.
- `pnpm collection show` prints saved images with `file` in place of `path`. Keep those as they are when you import again, and give only new images a `path`.
- Images aren't part of a group's receipt, so adding one doesn't reopen a reviewed group.

Import and hand over the link as the preread skill describes. If import fails with `Unknown field “images”`, the Preread checkout predates images: offer to update it.
