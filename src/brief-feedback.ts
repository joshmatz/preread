import type { BriefAnchor, BriefFeedback, BriefSnapshot, BriefBlock } from "./brief-types.ts";
import { exportCodeComments, type CodeComment } from "./code-comments.ts";
import type { Review } from "./review-types.ts";

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
const entriesWithCode = (snapshot: BriefSnapshot | undefined, comments: CodeComment[], groupTitle?: GroupTitle) => [
  ...(snapshot?.feedback.length || !comments.length ? [snapshot ? feedbackEntries(snapshot) : "No feedback yet."] : []),
  ...(comments.length ? [exportCodeComments(comments, groupTitle)] : []),
].join("\n\n");
export function exportBriefFeedback(title: string, snapshot: BriefSnapshot, review?: string, comments: CodeComment[] = [], groupTitle?: GroupTitle) {
  return `Feature: ${title}\n${review ? `Review: ${review}\n` : ""}Brief revision: ${snapshot.version}\n\n${entriesWithCode(snapshot, comments, groupTitle)}`;
}
export const exportReviewFeedback = (title: string, snapshot?: BriefSnapshot, comments: CodeComment[] = [], groupTitle?: GroupTitle) =>
  `Review: ${title}${snapshot ? `\nBrief revision: ${snapshot.version}` : ""}\n\n${entriesWithCode(snapshot, comments, groupTitle)}`;
export const groupTitleIn = (review: Pick<Review, "groups">): GroupTitle => (group) =>
  review.groups.find((entry) => entry.id === group)?.title ?? (group === "other-changes" ? (review.groups.length ? "Other changes" : "All changes") : undefined);
function feedbackEntries(snapshot: BriefSnapshot) {
  if (!snapshot.feedback.length) return "No feedback yet.";
  return snapshot.feedback.map((entry, index) => {
    const state = feedbackCurrent(entry, snapshot) ? "" : " [earlier revision]";
    const quote = entry.kind === "comment" ? anchorQuote(entry.anchor) : "";
    const context = entry.kind === "approval" ? `\nApproved code:\n${entry.block.code}\n${entry.block.reference ? `Group: ${entry.block.reference.review}/${entry.block.reference.group}\n${entry.block.reference.file ? `Source: ${entry.block.reference.file.path}:${entry.block.reference.file.start}–${entry.block.reference.file.end}\n` : ""}` : ""}`
      : entry.kind === "comment" && entry.anchor.kind === "selection"
        ? `\nAnchor: ${entry.anchor.segments.map((segment) => `${segment.block}/${segment.part} [${segment.start}:${segment.end}] @ ${segment.revision}`).join("; ")}\n` : "";
    const images = entry.kind === "comment" ? entry.attachments.map((image) => `\nImage: ${image.name}\nLocal attachment: ${image.path}`).join("\n") : "";
    return `${index + 1}. ${entry.kind}${state}: ${feedbackTitle(entry)}\n${quote ? `Selected text: “${quote}”\n` : ""}${feedbackBody(entry)}${context}${images}`;
  }).join("\n\n");
}
