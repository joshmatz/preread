import { origin, requestRefresh } from "../server/live.ts";
const page = process.argv.includes("--page");
const unknown = process.argv.slice(2).find((argument) => argument !== "--page");
if (unknown) {
  console.log("Usage: pnpm refresh [--page]\nRe-reads open review pages in place, or reloads them with --page.");
  process.exitCode = 1;
} else
  try {
    const pages = await requestRefresh(page);
    if (pages === null) {
      console.error(`No Worktree review server at ${origin}. Start it with pnpm start.`);
      process.exitCode = 1;
    } else if (!pages) console.log("No review pages are open. Share the review link instead.");
    else console.log(`${page ? "Reloaded" : "Refreshed"} ${pages} open ${pages === 1 ? "page" : "pages"}.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
