import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { CollectionImage } from "./review-types";

type Shown = { index: number; file: string };
const source = (file: string) => `/api/collection-image?${new URLSearchParams({ file })}`;
const host = (link: string) => URL.parse(link)?.hostname.replace(/^www\./, "") || link;
// The index tells identical images apart; the file finds an image that a refresh moved.
const find = (images: CollectionImage[] | undefined, shown: Shown | null) => {
  if (!shown) return undefined;
  const same = images?.[shown.index];
  return same?.file === shown.file ? same : images?.find((entry) => entry.file === shown.file);
};

export function DescriptionImages({ images }: { images?: CollectionImage[] }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const viewer = useRef<HTMLDialogElement>(null);
  // Dragging to select caption text and releasing over the backdrop also clicks the dialog.
  const pressedBackdrop = useRef(false);
  const image = find(images, shown);
  useEffect(() => {
    if (image) {
      if (!viewer.current?.open) viewer.current?.showModal();
    } else {
      viewer.current?.close();
      setShown(null);
    }
  }, [image]);
  if (!images?.length) return null;
  return (
    <div className="description-images">
      {images.map((entry, index) => (
        <Thumbnail
          key={`${index}:${entry.file}`}
          image={entry}
          onOpen={() => setShown({ index, file: entry.file })}
        />
      ))}
      <dialog
        ref={viewer}
        className="image-viewer"
        aria-label={image?.caption || "Image"}
        onClose={() => setShown(null)}
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && pressedBackdrop.current) setShown(null);
        }}
      >
        {image && (
          <div>
            <div className="dialog-heading">
              <p>{image.caption}</p>
              <button
                type="button"
                className="icon-button"
                aria-label="Close image"
                onClick={() => setShown(null)}
              >
                <X size={18} />
              </button>
            </div>
            <img src={source(image.file)} alt={image.caption ?? ""} />
            <div className="image-viewer-links">
              <a href={source(image.file)} target="_blank" rel="noreferrer">
                Open full size
              </a>
              {image.link && (
                <a href={image.link} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} />
                  Open in {host(image.link)}
                </a>
              )}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
function Thumbnail({ image, onOpen }: { image: CollectionImage; onOpen: () => void }) {
  // Every refresh brings new image objects, so a failed image loads again after a re-import.
  const [failed, setFailed] = useState<CollectionImage>();
  return (
    <figure className="description-image">
      {failed === image ? (
        <span className="image-missing">
          This image can’t be shown. Ask your agent to import it again.
        </span>
      ) : (
        <button type="button" title="Enlarge" onClick={onOpen}>
          <img
            src={source(image.file)}
            alt={image.caption || "Image"}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(image)}
          />
        </button>
      )}
      {image.caption && <figcaption title={image.caption}>{image.caption}</figcaption>}
    </figure>
  );
}
