import { performance } from "node:perf_hooks";
import type { Collection } from "../src/review-types.ts";

const origin = `http://127.0.0.1:${process.env.PORT || 4780}`;
async function get(route: string, values: Record<string, string> = {}) {
  const response = await fetch(`${origin}/api/${route}?${new URLSearchParams(values)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`);
  return result;
}
async function timed(label: string, action: () => Promise<unknown>) {
  const start = performance.now();
  await action();
  console.log(`${label}: ${Math.round(performance.now() - start)} ms`);
}
const collections: Collection[] = await get("collections");
const id = process.argv[2];
const collection = collections.find((entry) => entry.id === id);
if (!collection)
  throw new Error(`Choose a collection: ${collections.map((entry) => entry.id).join(", ")}`);
const selected = { collection: collection.id, review: collection.reviews[0].id };
console.log(
  `${collection.title} (${collection.reviews.length} items)\nRestart the server before running to measure a cold first open.`,
);
await timed("First review open", () => get("review", selected));
for (const label of ["All item statuses after first open", "Repeat all item statuses"]) {
  await timed(label, async () => {
    let index = 0;
    const worker = async () => {
      while (index < collection.reviews.length) {
        const review = collection.reviews[index];
        index += 1;
        await get("review-progress", { collection: collection.id, review: review.id });
      }
    };
    await Promise.all([worker(), worker()]);
  });
}
await timed("Repeat review open", () => get("review", selected));
