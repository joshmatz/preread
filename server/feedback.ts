import { readCollection } from "./collections.ts";
import { feedbackStore, storedBriefSnapshot } from "./briefs.ts";
import { commentStore, readCodeCommentState } from "./code-comments.ts";
import { agentReply } from "./threads.ts";
import { exportFeedback, feedbackTitle, groupTitleIn } from "../src/brief-feedback.ts";
import { codeCommentPlace } from "../src/code-comments.ts";
import type { BriefSnapshot } from "../src/brief-types.ts";
import { idMatches, noThreads, parseReplyId, readerChange, replyBody, replyId, shortIds, threadState, type ThreadEvent, type ThreadRoot, type Threads } from "../src/threads.ts";

// With a review, reads only that review, so damage elsewhere in the collection can't block it.
export async function collectionFeedback(collectionId: string, review?: string) {
  const collection = await readCollection(collectionId);
  if (review !== undefined && !collection.reviews.some((entry) => entry.id === review)) throw new Error("That review is not in this collection.");
  const feature = collection.brief && review === undefined ? await storedBriefSnapshot(collection) : undefined;
  const reviews = await Promise.all(collection.reviews.filter((entry) => review === undefined || entry.id === review).map(async (entry) => ({ review: entry,
    snapshot: entry.brief ? await storedBriefSnapshot(collection, entry.id) : undefined,
    code: await readCodeCommentState(collectionId, entry.id) })));
  const roots = [...(feature?.feedback ?? []), ...reviews.flatMap(({ snapshot, code }) => [...(snapshot?.feedback ?? []), ...code.comments])];
  return { collection, feature, reviews, ids: shortIds(roots.map((root) => root.id)) };
}
export async function feedbackText(collectionId: string, { review, ...options }: { review?: string; all?: boolean; checkout?: string } = {}) {
  const loaded = await collectionFeedback(collectionId, review);
  return exportFeedback({ collection: collectionId, title: loaded.collection.title, ids: loaded.ids, review,
    feature: loaded.feature, reviews: loaded.reviews.map(({ review: entry, snapshot, code }) => ({ title: entry.title, snapshot, code, groupTitle: groupTitleIn(entry) })) }, options);
}
export async function feedbackJson(collectionId: string, { review, all = false }: { review?: string; all?: boolean } = {}) {
  const loaded = await collectionFeedback(collectionId, review);
  const counts = noThreads();
  const keep = <T extends ThreadRoot>(roots: T[], threads: Threads) => roots.flatMap((root) => {
    const state = threadState(root, threads[root.id]);
    counts[state.turn] += 1;
    const events = threads[root.id] ?? [];
    return all || state.turn === "agent" ? [{ ...root, replyId: replyId(loaded.ids.get(root.id) ?? root.id, root, events),
      thread: { turn: state.turn, changed: state.turn !== "resolved" && state.changed, events } }] : [];
  });
  const brief = ({ threads, attention: _, ...snapshot }: BriefSnapshot) => ({ ...snapshot, feedback: keep(snapshot.feedback, threads) });
  // The collection brief's fields stay at the top level, where readers found them before reviews were added.
  const feature = loaded.feature && brief(loaded.feature);
  const reviews = loaded.reviews.map(({ review: entry, snapshot, code }) => {
    const shown = snapshot && brief(snapshot);
    return { review: entry.id, title: entry.title, ...shown, feedback: (shown?.feedback ?? []).map((item) => ({ ...item, review: entry.id })),
      codeComments: keep(code.comments, code.threads) };
  });
  return { ...feature, reviews: reviews.filter((entry) => review !== undefined || entry.version || entry.codeComments.length), threads: counts };
}

export type AgentReply = { id: string; body: string; resolve?: boolean; review?: string; feature?: boolean };
type Candidate = { review?: string; store: string; root: ThreadRoot; events: ThreadEvent[]; place: string };
// Checks every reply before writing any, so a typo, or a reply to something the reader changed since it was read, writes nothing.
export async function replyAsAgent(collectionId: string, replies: AgentReply[]) {
  const loaded = await collectionFeedback(collectionId);
  const candidates: Candidate[] = [
    ...(loaded.feature?.feedback ?? []).map((root) => ({ store: feedbackStore(collectionId), root, events: loaded.feature!.threads[root.id] ?? [],
      place: `feature overview: ${feedbackTitle(root)}` })),
    ...loaded.reviews.flatMap(({ review, snapshot, code }) => [
      ...(snapshot?.feedback ?? []).map((root) => ({ review: review.id, store: feedbackStore(collectionId, review.id), root,
        events: snapshot!.threads[root.id] ?? [], place: `${review.title}: ${feedbackTitle(root)}` })),
      ...code.comments.map((root) => ({ review: review.id, store: commentStore(collectionId, review.id), root,
        events: code.threads[root.id] ?? [], place: `${review.title}: ${codeCommentPlace(root)}` })),
    ]),
  ];
  const errors: string[] = [];
  let stale = false;
  const targets = replies.flatMap((reply) => {
    const fail = (message: string) => { errors.push(`${reply.id}: ${message}`); return []; };
    const parsed = parseReplyId(reply.id);
    if (!parsed) return fail("this is not an ID that pnpm feedback prints.");
    if (reply.review !== undefined && reply.feature) return fail("give a review or the feature overview, not both.");
    const body = replyBody.safeParse(reply.body);
    if (!body.success) return fail(body.error.issues[0]?.message ?? "This reply is not valid.");
    if (reply.review !== undefined && !loaded.reviews.some((entry) => entry.review.id === reply.review))
      return fail(`there is no review “${reply.review}” in this collection.`);
    const matches = candidates.filter((candidate) => idMatches(candidate.root.id, parsed.id)
      && (reply.review === undefined || candidate.review === reply.review) && (!reply.feature || candidate.review === undefined));
    if (!matches.length) return fail(`no feedback in ${collectionId} has this ID. pnpm feedback ${collectionId} --all prints every ID.`);
    if (matches.length > 1) return fail(`this matches ${matches.length} items: ${matches.map((match) =>
      `${match.place} (${match.review === undefined ? "--feature" : `--review ${match.review}`})`).join("; ")}. Add the option for the one you mean.`);
    const [target] = matches;
    const change = parsed.stamp === undefined ? "" : readerChange(parsed.stamp, target.root, target.events);
    if (change) { stale = true; return fail(`the reader ${change} after you read it (${target.place}).`); }
    return [{ ...target, body: body.data, resolve: !!reply.resolve }];
  });
  if (errors.length) throw new Error([...errors, stale ? `Nothing was sent. Read the feedback again with pnpm feedback ${collectionId}, then reply to what is there now.`
    : "Nothing was sent."].join("\n"));
  const written: boolean[] = [];
  for (const target of targets) written.push(await agentReply(target.store, target.root, target.body, target.resolve));
  return targets.map(({ root, place, resolve }, index) => ({ id: loaded.ids.get(root.id) ?? root.id, place, resolved: resolve, removed: !written[index] }));
}
