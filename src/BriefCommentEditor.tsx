import React, { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { BriefDialog } from "./BriefDialog";
import { CommentImages, commentImageUrl } from "./CommentImages";
import { anchorQuote } from "./brief-feedback";
import { briefScope } from "./brief-scope";
import { commentImageSchema, type BriefAnchor, type CommentImage } from "./brief-types";

export type BriefCommentDraft = { id: string; anchor: BriefAnchor; body: string; attachments: CommentImage[] };
type DraftImage = { kind: "local"; id: string; file: File; url: string } | { kind: "stored"; image: CommentImage; url: string };
const imageKey = (image: DraftImage) => image.kind === "local" ? image.id : image.image.id;
export function BriefCommentEditor({ collection, review, draft, saving, error, onSave, onClose }: {
  collection: string; review?: string; draft: BriefCommentDraft; saving: boolean; error: string;
  onSave: (body: string, attachments: string[]) => Promise<boolean>; onClose: () => void;
}) {
  const [body, setBody] = useState(draft.body);
  const [images, setImages] = useState<DraftImage[]>(() => draft.attachments.map((image) => ({ kind: "stored", image, url: commentImageUrl(collection, draft.id, image.id, review) })));
  const [posting, setPosting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  const busy = posting || saving;
  useEffect(() => () => { for (const url of objectUrls.current) URL.revokeObjectURL(url); }, []);
  const addImages = (files: File[]) => {
    if (busy || !files.length) return;
    if (images.length + files.length > 6) { setLocalError("Attach up to six images to one comment."); return; }
    if (files.some((file) => !/\.(png|jpe?g|webp|gif)$/i.test(file.name))) { setLocalError("Choose PNG, JPEG, WebP, or GIF images."); return; }
    if (files.some((file) => file.size > 10 * 1024 * 1024)) { setLocalError("Each image must be no larger than 10 MB."); return; }
    setLocalError("");
    setImages((current) => [...current, ...files.map((file): DraftImage => {
      const url = URL.createObjectURL(file); objectUrls.current.add(url);
      return { kind: "local", id: crypto.randomUUID(), file, url };
    })]);
  };
  return <BriefDialog title={draft.body || draft.attachments.length ? "Edit comment" : "Leave feedback"} busy={busy} onClose={onClose}>
    <form onPaste={(event) => {
      const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); addImages(files); }
    }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); addImages([...event.dataTransfer.files]); } }}
      onSubmit={async (event) => {
        event.preventDefault(); if (busy || (!body.trim() && !images.length)) return;
        setPosting(true); setLocalError("");
        try {
          const attachments: string[] = [];
          for (const [index, image] of images.entries()) {
            if (image.kind === "stored") { attachments.push(image.image.id); continue; }
            setStatus(`Uploading image ${index + 1} of ${images.length}…`);
            const response = await fetch(`/api/comment-images?${new URLSearchParams({ ...briefScope(collection, review), name: image.file.name })}`, {
              method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: image.file,
            });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || "Could not upload this image.");
            const stored = commentImageSchema.parse(value);
            attachments.push(stored.id);
            setImages((current) => current.map((entry) => imageKey(entry) === image.id ? { kind: "stored", image: stored, url: image.url } : entry));
          }
          setStatus("Saving comment…");
          await onSave(body.trim(), attachments);
        } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Could not save your images. Your comment is preserved."); }
        finally { setPosting(false); setStatus(""); }
      }}>
      {anchorQuote(draft.anchor) && <blockquote className="brief-quote">{anchorQuote(draft.anchor)}</blockquote>}
      <label className="brief-field-label" htmlFor="brief-comment">Your comment</label>
      <textarea id="brief-comment" value={body} onChange={(event) => setBody(event.target.value)} required={!images.length} maxLength={12000} disabled={busy} />
      <CommentImages images={images.map((image) => ({ id: imageKey(image), name: image.kind === "local" ? image.file.name : image.image.name, url: image.url }))} busy={busy}
        onRemove={(id) => { const removed = images.find((image) => imageKey(image) === id); if (removed && objectUrls.current.delete(removed.url)) URL.revokeObjectURL(removed.url); setImages((current) => current.filter((image) => imageKey(image) !== id)); }} />
      <div className="comment-attachment-actions"><button className="brief-secondary" type="button" disabled={busy || images.length >= 6} onClick={() => input.current?.click()}><ImagePlus size={15} />Attach images</button>
        <small>Or paste or drop images here. Up to six, 10 MB each.</small></div>
      <input ref={input} type="file" className="sr-only" aria-label="Attach comment images" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy}
        onChange={(event) => { addImages([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
      {(localError || error) && <p className="brief-error" role="alert">{localError || error}</p>}
      <div className="brief-dialog-actions"><span role="status">{status || "Saved with its passage and revision."}</span><button className="primary" type="submit" disabled={busy || (!body.trim() && !images.length)}>{busy ? "Saving…" : "Save comment"}</button></div>
    </form>
  </BriefDialog>;
}
