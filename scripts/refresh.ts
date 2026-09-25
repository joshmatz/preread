import { origin, requestRefresh } from "../server/live.ts";
const page = process.argv.includes("--page");
const unknown = process.argv.slice(2).find((argument) => argument !== "--page");
if (unknown) {
  console.log("Usage: pnpm refresh [--page]\nRe-reads open review pages in place, or reloads them with --page.");
  process.exitCode = 1;
} else
  try {
    if (await requestRefresh(page))
      console.log(`Open review pages will ${page ? "reload" : "refresh"} within a second.`);
    else {
      console.error(`No Worktree review server at ${origin}. Start it with pnpm start.`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
