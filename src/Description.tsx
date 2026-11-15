import React, { useLayoutEffect, useRef, useState } from "react";

export function Description({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const paragraph = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = paragraph.current!;
    if (expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return (
    <div className={`review-description${className ? ` ${className}` : ""}${expanded ? " expanded" : ""}`}>
      <p ref={paragraph}>{text}</p>
      {(clamped || expanded) && (
        <button className="more-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
