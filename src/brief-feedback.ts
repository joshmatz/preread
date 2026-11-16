import type { BriefAnchor, BriefFeedback, BriefSnapshot, BriefBlock } from "./brief-types.ts";
import { codeCommentPlace, lineText, sortCodeComments, type CodeComment, type CodeCommentState } from "./code-comments.ts";
import type { Review } from "./review-types.ts";
import { noThreads, replyId, threadLines, threadState, turnLabel, type ThreadEvent, type ThreadRoot, type ThreadState, type Threads } from "./threads.ts";

export const blockTitle = (block: BriefBlock): string => {
  switch (block.kind) {
    case "markdown": return block.markdown.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 180) || "Passage";
    case "question": return block.question.slice(0, 180);
    case "code": return block.title || "Code excerpt";
    case "visual": return block.visual.title;
  }
};
export function anchorQuote(anchor: BriefAnchor) {
  return anchor.kind === "selection"
    ? anchor.segments.map((segment) => segment.text.slice(segment.start, segment.end)).join("\n\n")
    : "";
}
export function feedbackCurrent(entry: BriefFeedback, snapshot: Pick<BriefSnapshot, "version" | "fingerprints">) {
  if (entry.kind !== "comment") return snapshot.fingerprints[entry.block.id] === entry.revision;
  const anchor = entry.anchor;
  if (anchor.kind === "document") return anchor.revision === snapshot.version;
  if (anchor.kind === "block") return snapshot.fingerprints[anchor.block] === anchor.revision;
  return anchor.segments.every((segment) => snapshot.fingerprints[segment.block] === segment.revision);
}
export function feedbackTitle(entry: BriefFeedback) {
  if (entry.kind !== "comment") return blockTitle(entry.block);
  return entry.anchor.kind === "selection" ? "Selected passage" : entry.anchor.title;
}
export function feedbackBody(entry: BriefFeedback) {
  switch (entry.kind) {
    case "comment": return entry.body;
    case "approval": return "Approved this exact code excerpt. This does not approve its whole group or authorize publishing.";
    case "answer": return entry.answer.kind === "custom" ? entry.answer.text
      : entry.block.options.find((option) => entry.answer.kind === "option" && option.id === entry.answer.option)?.label || "Unavailable option";
  }
}
type GroupTitle = (group: string) => string | undefined;
export const groupTitleIn = (review: Pick<Review, "groups">): GroupTitle => (group) =>
  review.groups.find((entry) => entry.id === group)?.title ?? (group === "other-changes" ? (review.groups.length ? "Other changes" : "All changes") : undefined);
const labelled = (heading: string, labels: string[]) => `${heading}${labels.length ? ` [${labels.join("; ")}]` : ""}`;
function briefEntryText(entry: BriefFeedback, snapshot: BriefSnapshot, id: string, index: number, state: ThreadState, events: ThreadEvent[]) {
  const labels = [...(feedbackCurrent(entry, snapshot) ? [] : ["earlier revision"]), ...(turnLabel(state) ? [turnLabel(state)] : [])];
  const quote = entry.kind === "comment" ? anchorQuote(entry.anchor) : "";
  const lines = [labelled(`${index + 1}. ${entry.kind}`, labels) + `: ${feedbackTitle(entry)}`, `ID: ${id}`, ...(quote ? [`Selected text: “${quote}”`] : []), feedbackBody(entry)];
  if (entry.kind === "approval") {
    const reference = entry.block.reference;
    lines.push("Approved code:", entry.block.code, ...(reference ? [`Group: ${reference.review}/${reference.group}`] : []),
      ...(reference?.file ? [`Source: ${reference.file.path}:${reference.file.start}–${reference.file.end}`] : []));
  }
  if (entry.kind === "comment") {
    if (entry.anchor.kind === "selection")
      lines.push(`Anchor: ${entry.anchor.segments.map((segment) => `${segment.block}/${segment.part} [${segment.start}:${segment.end}] @ ${segment.revision}`).join("; ")}`);
    for (const image of entry.attachments) lines.push(`Image: ${image.name}`, `Local attachment: ${image.path}`);
  }
  return [...lines, ...threadLines(entry, events)].join("\n");
}
function codeCommentText(comment: CodeComment, id: string, index: number, state: ThreadState, events: ThreadEvent[], groupTitle?: GroupTitle) {
  const group = groupTitle?.(comment.group);
  return [labelled(`${index + 1}. ${codeCommentPlace(comment)}`, turnLabel(state) ? [turnLabel(state)] : []), `ID: ${id}`,
    ...(group ? [`Group: ${group}`] : []), ...(comment.line ? [`Line: ${lineText(comment.line)}`] : []), comment.body, ...threadLines(comment, events)].join("\n");
}
const shellWord = (value: string) => /^[\w./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
export type FeedbackReview = { title: string; snapshot?: BriefSnapshot; code: CodeCommentState; groupTitle?: GroupTitle };
export type FeedbackSource = {
  collection: string; title: string; feature?: BriefSnapshot; reviews: FeedbackReview[];
  ids: ReadonlyMap<string, string>;
  // Set when one review was asked for: its heading prints even with nothing in it, and hints stay scoped to it.
  review?: string;
};
// Prints what waits on the agent, or everything with `all`, with each item's ID for `pnpm feedback reply`.
export function exportFeedback(source: FeedbackSource, { all = false, checkout }: { all?: boolean; checkout?: string } = {}) {
  const counts = noThreads();
  let shown = 0;
  const pick = <T extends ThreadRoot>(roots: T[], threads: Threads) => roots.flatMap((root) => {
    const state = threadState(root, threads[root.id]);
    counts[state.turn] += 1;
    if (!all && state.turn !== "agent") return [];
    shown += 1;
    return [{ root, state, events: threads[root.id] ?? [] }];
  });
  const idOf = (root: ThreadRoot, events: ThreadEvent[]) => replyId(source.ids.get(root.id) ?? root.id, root, events);
  const briefItems = (snapshot?: BriefSnapshot) => snapshot ? pick(snapshot.feedback, snapshot.threads)
    .map(({ root, state, events }, index) => briefEntryText(root, snapshot, idOf(root, events), index, state, events)) : [];
  const brief = (snapshot: BriefSnapshot | undefined, items: string[]) => items.length ? `\nBrief revision: ${snapshot!.version}\n\n${items.join("\n\n")}` : "";
  const featureItems = briefItems(source.feature);
  const sections = [`Feature: ${source.title}${brief(source.feature, featureItems)}`];
  const quiet: string[] = [];
  for (const review of source.reviews) {
    const items = briefItems(review.snapshot);
    const code = pick(sortCodeComments(review.code.comments), review.code.threads)
      .map(({ root, state, events }, index) => codeCommentText(root, idOf(root, events), index, state, events, review.groupTitle));
    if (!items.length && !code.length && source.review === undefined) { quiet.push(review.title); continue; }
    sections.push(`Review: ${review.title}${brief(review.snapshot, items)}${code.length ? `\n\nCode comments:\n\n${code.join("\n\n")}` : ""}`);
  }
  const command = `pnpm${checkout ? ` --dir ${shellWord(checkout)}` : ""} feedback`;
  const hidden = [counts.person && `${counts.person} waiting on the reader`, counts.resolved && `${counts.resolved} resolved`].filter(Boolean);
  const footer = [
    ...(!shown ? [counts.agent + counts.person + counts.resolved ? "Nothing is waiting on the agent." : "No feedback yet."]
      : quiet.length ? [`${all ? "No feedback on" : "Nothing waiting on the agent in"} ${quiet.length === 1 ? "review" : "reviews"}: ${quiet.join("; ")}`] : []),
    ...(!all && hidden.length ? [`Not shown: ${hidden.join(", ")}; ${command} ${source.collection}${source.review ? ` --review ${source.review}` : ""} --all prints them.`] : []),
    ...(shown ? [`Reply to an item with ${command} reply ${source.collection} <ID> "<reply>", adding --resolve once it is handled.`] : []),
  ];
  return { text: [...sections, footer.join("\n")].join("\n\n"), counts, shown };
}
