import React from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedCode } from "./HighlightedCode";
import { BriefGroupStatus, type GroupReadState } from "./BriefGroupStatus";

// Without a group, a link opens the review itself: its brief, or its code when it has none.
export type BriefLink = { review: string; group?: string };
const reference = /^preread:([a-z0-9][a-z0-9-]{0,79})(?:\/([a-z0-9][a-z0-9-]{0,79}))?$/;
export function Markdown({ children, onReference, referenceState }: {
  children: string; onReference?: (reference: BriefLink) => void; referenceState?: (reference: BriefLink) => GroupReadState | undefined;
}) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url) => reference.test(url) ? url : defaultUrlTransform(url)}
    components={{
      code: ({ children, className }) => typeof children === "string" && className?.startsWith("language-")
        ? <HighlightedCode code={children} language={className.slice(9)} /> : <code className={className}>{children}</code>,
      img: () => <span className="muted">[Use an imported visual block to show this image.]</span>,
      a: ({ href, children }) => {
        const match = href?.match(reference);
        if (match) {
          const target: BriefLink = match[2] ? { review: match[1], group: match[2] } : { review: match[1] };
          const state = referenceState?.(target);
          return onReference
            ? <button className="brief-inline-reference" onClick={() => onReference(target)}>{children} ↗{state
              && <BriefGroupStatus state={state} subject={target.group ? undefined : "Review"} />}</button>
            : <span>{children}</span>;
        }
        return href ? <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer">{children}</a> : <span>{children}</span>;
      },
    }}>{children}</ReactMarkdown></div>;
}
