import { useState } from "react";
import type { ImageSide, Mode } from "./types";
import type { FilePreview } from "./review-types";

const labels: Record<ImageSide, { changed: string; alone: string }> = {
  old: { changed: "Before", alone: "Deleted" },
  new: { changed: "After", alone: "Added" },
};
const formatSize = (bytes: number) =>
  bytes < 1000
    ? `${bytes} B`
    : bytes < 1_000_000
      ? `${Math.round(bytes / 1000)} KB`
      : `${(bytes / 1_000_000).toFixed(1)} MB`;

export function ImageDiff({
  preview,
  split,
  source,
}: {
  preview: FilePreview;
  split: boolean;
  source: { path: string; base: string; mode: Mode };
}) {
  const image = preview.diff.image!;
  const sides = (["old", "new"] as const).filter((side) => image[side]);
  return (
    <div className={`image-diff${split && sides.length > 1 ? " split" : ""}`}>
      {sides.map((side) => (
        <ImageVersion
          key={side}
          side={side}
          label={sides.length > 1 ? labels[side].changed : labels[side].alone}
          name={preview.file.path}
          size={image[side]!.size}
          url={`/api/image?${new URLSearchParams({
            path: source.path,
            base: source.base,
            mode: source.mode,
            file: preview.file.path,
            side,
            hash: preview.contextHash ?? preview.diff.hash,
          })}`}
        />
      ))}
    </div>
  );
}
function ImageVersion({
  side,
  label,
  name,
  size,
  url,
}: {
  side: ImageSide;
  label: string;
  name: string;
  size: number;
  url: string;
}) {
  const [dimensions, setDimensions] = useState("");
  const [error, setError] = useState("");
  return (
    <figure className={`image-version ${side}`}>
      <figcaption>
        <strong>{label}</strong>
        <span>{[formatSize(size), dimensions].filter(Boolean).join(" · ")}</span>
      </figcaption>
      {error ? (
        <p className="image-error">{error}</p>
      ) : (
        <a
          className="image-frame"
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open full size"
        >
          <img
            src={url}
            alt={`${label}: ${name}`}
            loading="lazy"
            decoding="async"
            onLoad={(event) =>
              setDimensions(
                `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
              )
            }
            onError={async () => {
              // An image element can't read the server's reason, so ask for it once.
              const response = await fetch(url).catch(() => null);
              const reason =
                response && !response.ok
                  ? await response.json().then(
                      (data) => data.error,
                      () => "",
                    )
                  : "";
              setError(reason || "This image couldn't be displayed. Open the file locally.");
            }}
          />
        </a>
      )}
    </figure>
  );
}
