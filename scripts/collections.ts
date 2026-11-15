import { readFile } from "node:fs/promises";
import {
  deleteCollection,
  listCollections,
  putCollection,
  putCollectionBrief,
  readCollection,
  dataDirectory,
} from "../server/collections.ts";
import { origin, requestRefresh } from "../server/live.ts";
const args = process.argv.slice(2);
const flag = args.indexOf("--review");
const review = flag === -1 ? undefined : args[flag + 1];
const [command, argument, source, ...extra] = flag === -1 ? args : args.filter((_, index) => index !== flag && index !== flag + 1);
const refreshOpenPages = () =>
  requestRefresh(false).then(
    (sent) => sent && console.log("Open review pages will refresh within a second."),
    (error: Error) => console.log(`Open pages were not refreshed: ${error.message}`),
  );
try {
  if (flag !== -1 && (command !== "brief" || !review || review.startsWith("--") || extra.length)) {
    console.log(`Usage: pnpm collection brief <id> --review <review-id> <brief.json>\nData: ${dataDirectory()}`);
    process.exitCode = 1;
  } else if (command === "import" && argument) {
    const collection = await putCollection(JSON.parse(await readFile(argument, "utf8")));
    const first = collection.reviews[0];
    console.log(
      `Saved ${collection.title} (${collection.reviews.length} reviews).\n${origin}/?collection=${collection.id}&${collection.brief ? "view=brief" : `review=${first.id}${first.brief ? "&view=brief" : ""}`}`,
    );
    await refreshOpenPages();
  } else if (command === "brief" && argument && source && review !== undefined) {
    const collection = await putCollectionBrief(argument, JSON.parse(await readFile(source, "utf8")), review);
    const title = collection.reviews.find((entry) => entry.id === review)?.title;
    console.log(`Saved the brief for ${title} in ${collection.title}; nothing else was changed.\n${origin}/?collection=${collection.id}&review=${review}&view=brief`);
    await refreshOpenPages();
  } else if (command === "brief" && argument && source) {
    const collection = await putCollectionBrief(argument, JSON.parse(await readFile(source, "utf8")));
    console.log(`Saved the brief for ${collection.title}; review metadata was not changed.\n${origin}/?collection=${collection.id}&view=brief`);
    await refreshOpenPages();
  } else if (command === "delete" && argument) {
    await deleteCollection(argument);
    console.log(`Deleted ${argument}.`);
    await refreshOpenPages();
  } else if (command === "show" && argument)
    console.log(JSON.stringify(await readCollection(argument), null, 2));
  else if (command === "list") console.log(JSON.stringify(await listCollections(), null, 2));
  else {
    console.log(
      `Usage: pnpm collection import <manifest.json> | brief <id> [--review <review-id>] <brief.json> | show <id> | list | delete <id>\nData: ${dataDirectory()}`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
