import { collectionFeedbackText, storedBriefSnapshot } from "../server/briefs.ts";
import { readCodeComments } from "../server/code-comments.ts";
import { readCollection } from "../server/collections.ts";
import { exportReviewFeedback, groupTitleIn } from "../src/brief-feedback.ts";

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
      const feature = review === undefined && collection.brief ? await storedBriefSnapshot(collection) : undefined;
      const reviews = await Promise.all(collection.reviews.filter((entry) => review === undefined || entry.id === review).map(async (entry) => ({
        review: entry, snapshot: entry.brief ? await storedBriefSnapshot(collection, entry.id) : undefined, comments: await readCodeComments(id, entry.id),
      })));
      if (json) {
        // The collection brief's fields stay at the top level, where readers found them before reviews were added.
        console.log(JSON.stringify({ ...feature, reviews: reviews.filter((entry) => review !== undefined || entry.snapshot || entry.comments.length)
          .map(({ review: entry, snapshot, comments }) => ({ review: entry.id, title: entry.title, ...snapshot,
            feedback: (snapshot?.feedback ?? []).map((item) => ({ ...item, review: entry.id })), codeComments: comments })) }, null, 2));
      } else {
        console.log([`Feature: ${collection.title}`, ...reviews.map(({ review: entry, snapshot, comments }) =>
          exportReviewFeedback(entry.title, snapshot, comments, groupTitleIn(entry)))].join("\n\n"));
      }
    }
  } catch (error) { console.error(error instanceof Error ? error.message : "Could not read feature feedback."); process.exitCode = 1; }
}
