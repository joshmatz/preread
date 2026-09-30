import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createServer as createViteServer } from "vite";
import { repository, comparison, fileDiff, fileContext, fileImage, stackFor } from "./git.ts";
import { listCollections, putCollection } from "./collections.ts";
import { bump, live } from "./live.ts";
import { snapshot, adHocReview, resolveReview, markGroup } from "./review.ts";
import { reviewProgress, progressSource } from "../src/progress.ts";
import type { Mode } from "../src/types.ts";

import { readPullRequest } from "./pullRequests.ts";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT || 4780);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
app.disable("x-powered-by");
app.use("/api", (req, res, next) => {
  const origin = req.get("origin");
  const host = req.get("host") ?? "";
  const site = req.get("sec-fetch-site");
  if (
    !hosts.has(host) ||
    (origin && origin !== `http://${host}`) ||
    (site && site !== "same-origin" && site !== "none")
  ) {
    res.status(403).json({ error: "Local review requests must come from this app." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use("/api", express.json({ limit: "1mb" }));
const query = (value: unknown) => (typeof value === "string" ? value : "");
app.get("/api/bootstrap", (_req, res) =>
  res.json({ defaultPath: process.argv[2] ?? process.env.REVIEW_PATH ?? "" }),
);
app.get("/api/live", (_req, res) => res.json(live));
app.post("/api/refresh", (req, res) => {
  const page = req.body?.page ?? false;
  if (typeof page !== "boolean") throw new Error("Invalid refresh request.");
  res.json(bump(page));
});
app.get("/api/repository", async (req, res) => res.json(await repository(query(req.query.path))));
app.get("/api/compare", async (req, res) =>
  res.json(
    await comparison(query(req.query.path), query(req.query.base), query(req.query.mode) as Mode),
  ),
);
app.get("/api/diff", async (req, res) =>
  res.json(
    await fileDiff(
      query(req.query.path),
      query(req.query.base),
      query(req.query.mode) as Mode,
      query(req.query.file),
    ),
  ),
);
app.get("/api/context", async (req, res) =>
  res.json(
    await fileContext(
      query(req.query.path),
      query(req.query.base),
      query(req.query.mode) as Mode,
      query(req.query.file),
      query(req.query.version),
      query(req.query.hash),
    ),
  ),
);
app.get("/api/image", async (req, res) => {
  const { content, type } = await fileImage(
    query(req.query.path),
    query(req.query.base),
    query(req.query.mode) as Mode,
    query(req.query.file),
    query(req.query.side),
    query(req.query.hash),
  );
  // Opened in a tab of its own, the file still can't run script with this origin's access.
  res.set("Content-Security-Policy", "default-src 'none'; sandbox").type(type).send(content);
});
app.get("/api/collections", async (_req, res) => res.json(await listCollections()));
app.put("/api/collections", async (req, res) => res.json(await putCollection(req.body)));
app.get("/api/review-progress", async (req, res) => {
  const collectionId = query(req.query.collection);
  const review = await resolveReview(collectionId, query(req.query.review));
  const current = await snapshot(review, collectionId);
  res.json({ ...reviewProgress(current), source: progressSource(current) });
});
app.get("/api/pull-request", async (req, res) => {
  const review = await resolveReview(query(req.query.collection), query(req.query.review));
  res.json(
    review.pullRequest
      ? await readPullRequest(review.pullRequest, req.query.refresh === "1")
      : null,
  );
});
app.get("/api/review", async (req, res) => {
  const collectionId = query(req.query.collection);
  const review = collectionId
    ? await resolveReview(collectionId, query(req.query.review))
    : adHocReview(query(req.query.path), query(req.query.base), query(req.query.mode) as Mode);
  res.json(await snapshot(review, collectionId || undefined));
});
app.post("/api/reviewed", async (req, res) => {
  const { collection, review, group, fingerprint, reviewed } = req.body ?? {};
  if (
    ![collection, review, group, fingerprint].every((value) => typeof value === "string") ||
    typeof reviewed !== "boolean"
  )
    throw new Error("Invalid review status request.");
  res.json(await markGroup(collection, review, group, fingerprint, reviewed));
});
app.get("/api/stack", async (req, res) => res.json(await stackFor(query(req.query.path))));
app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown local review endpoint." }));
app.use(
  (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error.message.includes("not a git repository")
      ? "That folder is not a Git repository. Choose a repository or worktree folder."
      : error.message;
    res.status(400).json({ error: message.slice(0, 1200) });
  },
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(root, "dist/index.html")));
} else {
  // Without an HMR server, middleware mode opens its own WebSocket port on every interface.
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Set PORT to use another port.`
      : error.message,
  );
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => console.log(`Preread: http://127.0.0.1:${port}`));
