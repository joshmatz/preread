import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const text = (max: number) => z.string().max(max).refine((value) => !value.includes("\0"));
const content = (max: number) => text(max).refine((value) => !!value.trim(), "Content is required.");
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const fileLocation = z.strictObject({
  path: content(4000).refine((value) => !value.startsWith("/") && !value.includes("\\") && !/^[a-z]:/i.test(value)
    && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "Use a repository-relative file path."),
  start: z.number().int().positive(), end: z.number().int().positive(),
}).refine((value) => value.end >= value.start, "Source lines must be ordered.");
const reference = z.strictObject({ review: id, group: id, file: fileLocation.optional() });
const visual = z.strictObject({ id, title: content(200), path: content(4000), caption: text(2000).optional() });
const markdown = z.strictObject({ id, kind: z.literal("markdown"), markdown: content(64000) });
const question = z.strictObject({
  id, kind: z.literal("question"), question: content(2000), description: text(4000).optional(),
  options: z.array(z.strictObject({ id, label: content(200), description: text(1000).optional(), recommended: z.boolean().optional() })).min(2).max(8),
}).refine((value) => new Set(value.options.map((option) => option.id)).size === value.options.length, "Question option IDs must be unique.")
  .refine((value) => value.options.filter((option) => option.recommended).length <= 1, "Only one option can be recommended.");
const code = z.strictObject({
  id, kind: z.literal("code"), title: content(200).optional(), language: text(40).default("text"),
  code: content(64000), approval: z.boolean().default(false), reference: reference.optional(),
});
const image = z.strictObject({ id, kind: z.literal("visual"), visual });
export const briefBlockSchema = z.discriminatedUnion("kind", [markdown, question, code, image]);
export const briefSchema = z.strictObject({ blocks: z.array(briefBlockSchema).min(1).max(100) })
  .refine((value) => new Set(value.blocks.map((block) => block.id)).size === value.blocks.length, "Brief block IDs must be unique.")
  .refine((value) => value.blocks.filter((block) => block.kind === "visual").length <= 12, "A brief can include at most 12 visuals.")
  .refine((value) => JSON.stringify(value).length <= 400000, "The brief is too large.");
export type FeatureBrief = z.infer<typeof briefSchema>;
export type BriefBlock = z.infer<typeof briefBlockSchema>;
export type QuestionBlock = z.infer<typeof question>;
export type CodeBlock = z.infer<typeof code>;
export type BriefReference = z.infer<typeof reference>;

const segment = z.strictObject({
  block: id, revision, part: z.enum(["markdown", "question", "code", "caption"]),
  text: content(64000), start: z.number().int().nonnegative(), end: z.number().int().positive(),
}).refine((value) => value.end > value.start && value.end <= value.text.length, "Invalid selected text range.");
const selection = z.strictObject({ kind: z.literal("selection"), segments: z.array(segment).min(1).max(20) })
  .refine((value) => value.segments.reduce((size, entry) => size + entry.text.length, 0) <= 256000, "The selection is too large.");
const blockAnchor = z.strictObject({ kind: z.literal("block"), block: id, revision, title: content(200) });
const documentAnchor = z.strictObject({ kind: z.literal("document"), revision, title: content(200) });
const anchor = z.discriminatedUnion("kind", [selection, blockAnchor, documentAnchor]);
export type BriefAnchor = z.infer<typeof anchor>;
export type BriefSelection = z.infer<typeof selection>;
export type BriefSegment = z.infer<typeof segment>;
const answer = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("option"), option: id }),
  z.strictObject({ kind: z.literal("custom"), text: content(4000) }),
]);
export type BriefAnswer = z.infer<typeof answer>;
const entryId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/);
const common = { id: entryId, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
export const commentImageSchema = z.strictObject({ id: z.uuid(), name: content(200), path: content(4000) });
export type CommentImage = z.infer<typeof commentImageSchema>;
const comment = z.strictObject({ ...common, kind: z.literal("comment"), body: text(12000), anchor,
  attachments: z.array(commentImageSchema).max(6).default([]),
}).refine((value) => !!value.body.trim() || value.attachments.length > 0, "Write a comment or attach an image.");
export const briefFeedbackSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("answer"), revision, block: question, answer }),
  z.strictObject({ ...common, kind: z.literal("approval"), revision, block: code }),
  comment,
]);
export type BriefFeedback = z.infer<typeof briefFeedbackSchema>;
export const briefCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("answer"), block: id, revision, answer }),
  z.strictObject({ kind: z.literal("approve"), block: id, revision, approved: z.boolean() }),
  z.strictObject({ kind: z.literal("comment"), id: z.uuid(), body: text(12000), anchor,
    attachments: z.array(z.uuid()).max(6).default([]),
  }).refine((value) => !!value.body.trim() || value.attachments.length > 0, "Write a comment or attach an image.")
    .refine((value) => new Set(value.attachments).size === value.attachments.length, "Attach each image once."),
  z.strictObject({ kind: z.literal("delete"), id: entryId }),
]);
export type BriefCommand = z.infer<typeof briefCommandSchema>;
export interface BriefAttention {
  questions: Array<{ block: string; question: string }>;
  approvals: Array<{ block: string; title: string }>;
  comments: number;
  feedback: number;
}
export interface CollectionAttention {
  feature?: BriefAttention;
  reviews: Record<string, BriefAttention>;
  codeComments?: Record<string, number>;
}
export interface BriefSnapshot {
  brief: FeatureBrief;
  version: string;
  fingerprints: Record<string, string>;
  feedback: BriefFeedback[];
  // Every brief in the collection, read when this snapshot was made, for the contents and the attention panel.
  attention?: CollectionAttention;
}
