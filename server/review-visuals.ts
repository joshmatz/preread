import { readCollection, dataDirectory } from "./collections.ts";
import { visualAsset } from "./visual-assets.ts";

async function target(collection: string, reviewId: string, groupId: string) {
  const current = await readCollection(collection);
  const review = current.reviews.find((entry) => entry.id === reviewId);
  if (!review) throw new Error("This review is not in the collection.");
  const owner = groupId ? review.groups.find((group) => group.id === groupId) : review;
  if (!owner) throw new Error("This group is not in the review.");
  return { current, owner };
}
export async function readVisual(collection: string, review: string, group: string, id: string) {
  const { owner } = await target(collection, review, group);
  const visual = owner.visuals?.find((entry) => entry.id === id);
  if (!visual) throw new Error("This visual is not attached here.");
  return visualAsset(visual.path, dataDirectory());
}
