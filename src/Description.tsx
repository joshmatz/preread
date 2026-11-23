import React, { useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

export function Description({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = body.current!;
    if (expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return (
    <div className={`review-description${className ? ` ${className}` : ""}${expanded ? " expanded" : ""}`}>
      <div ref={body} className="description-text"><Markdown>{text}</Markdown></div>
      {(clamped || expanded) && (
        <button className="more-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
