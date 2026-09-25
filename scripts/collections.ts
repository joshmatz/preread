import { readFile } from "node:fs/promises";
import {
  listCollections,
  putCollection,
  readCollection,
  dataDirectory,
} from "../server/collections.ts";
import { origin, requestRefresh } from "../server/live.ts";
const [command, argument] = process.argv.slice(2);
try {
  if (command === "import" && argument) {
    const collection = await putCollection(JSON.parse(await readFile(argument, "utf8")));
    console.log(
      `Saved ${collection.title} (${collection.reviews.length} reviews).\n${origin}/?collection=${collection.id}&review=${collection.reviews[0].id}`,
    );
    const refreshed = await requestRefresh(false).then(
      (sent) => (sent ? "Open review pages will refresh within a second." : ""),
      (error: Error) => `Open pages were not refreshed: ${error.message}`,
    );
    if (refreshed) console.log(refreshed);
  } else if (command === "show" && argument)
    console.log(JSON.stringify(await readCollection(argument), null, 2));
  else if (command === "list") console.log(JSON.stringify(await listCollections(), null, 2));
  else {
    console.log(
      `Usage: pnpm collection import <manifest.json> | show <id> | list\nData: ${dataDirectory()}`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
