import { collectionFeedbackText, storedBriefSnapshot } from "../server/briefs.ts";
import { readCollection } from "../server/collections.ts";
import { exportReviewFeedback } from "../src/brief-feedback.ts";

const args = process.argv.slice(2);
const flag = args.indexOf("--review");
const review = flag === -1 ? undefined : args[flag + 1];
const json = args.includes("--json");
const [id, ...extra] = args.filter((value, index) => value !== "--json" && (flag === -1 || (index !== flag && index !== flag + 1)));
if (!id || extra.length || (flag !== -1 && (!review || review.startsWith("--")))) {
  console.error("Usage: pnpm feedback <collection-id> [--review <review-id>] [--json]");
  process.exitCode = 1;
} else {
  try {
    if (!json && review === undefined) console.log((await collectionFeedbackText(id)).text);
    else {
      const collection = await readCollection(id);
      if (review !== undefined && !collection.reviews.some((entry) => entry.id === review))
        throw new Error("That review is not in this collection.");
      const reviews = collection.reviews.filter((entry) => entry.brief && (review === undefined || entry.id === review));
      if (review !== undefined && !reviews.length) throw new Error("This review has no brief.");
      const feature = review === undefined && collection.brief ? await storedBriefSnapshot(collection) : undefined;
      if (!feature && !reviews.length) throw new Error("This collection has no feature brief or review briefs.");
      const briefs = await Promise.all(reviews.map(async (entry) => ({ review: entry, snapshot: await storedBriefSnapshot(collection, entry.id) })));
      if (json) {
        // The collection brief keeps its original top-level shape; review briefs follow under reviews.
        console.log(JSON.stringify({ ...feature, reviews: briefs.map(({ review: entry, snapshot }) => ({
          review: entry.id, title: entry.title, ...snapshot, feedback: snapshot.feedback.map((item) => ({ ...item, review: entry.id })),
        })) }, null, 2));
      } else {
        console.log([`Feature: ${collection.title}`, ...briefs.map(({ review: entry, snapshot }) => exportReviewFeedback(entry.title, snapshot))].join("\n\n"));
      }
    }
  } catch (error) { console.error(error instanceof Error ? error.message : "Could not read feature feedback."); process.exitCode = 1; }
}
