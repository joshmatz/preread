import React, { useState } from "react";
import { X } from "lucide-react";
import { BriefDialog } from "./BriefDialog";
import type { CommentImage } from "./brief-types";
import { briefScope } from "./brief-scope";

export const commentImageUrl = (collection: string, comment: string, image: string, review?: string) =>
  `/api/comment-image?${new URLSearchParams({ ...briefScope(collection, review), comment, image })}`;
export const savedCommentImages = (collection: string, comment: string, images: CommentImage[], review?: string) =>
  images.map((image) => ({ id: image.id, name: image.name, url: commentImageUrl(collection, comment, image.id, review) }));
export function CommentImages({ images, onRemove, busy = false }: {
  images: Array<{ id: string; name: string; url: string }>; onRemove?: (id: string) => void; busy?: boolean;
}) {
  const [expanded, setExpanded] = useState<{ name: string; url: string } | null>(null);
  if (!images.length) return null;
  return <div className="comment-images">{images.map((image) => <figure key={image.id}>
    <button type="button" className="comment-image-preview" aria-label={`Expand ${image.name}`} onClick={() => setExpanded(image)}><img src={image.url} alt={image.name} /></button>
    <figcaption>{image.name}</figcaption>
    {onRemove && <button type="button" className="comment-image-remove" disabled={busy} aria-label={`Remove ${image.name}`} onClick={() => onRemove(image.id)}><X size={14} /></button>}
  </figure>)}
    {expanded && <BriefDialog title={expanded.name} wide onClose={() => setExpanded(null)}><img className="brief-expanded-image" src={expanded.url} alt={expanded.name} /></BriefDialog>}
  </div>;
}
