import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCheck, LoaderCircle } from "lucide-react";
import type { ReviewSection } from "./review-types";

export function GroupReviewButton({ section, busy, disabled, tabIndex, onClick }: {
  section: ReviewSection; busy: boolean; disabled: boolean; tabIndex?: number; onClick: () => void;
}) {
  return (
    <button
      className={`review-button ${section.reviewed ? "is-reviewed" : ""}`}
      aria-pressed={section.reviewed}
      title={section.reviewed ? "Unmark all files in this group" : "Mark all files in this group viewed"}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onClick}
    >
      {busy ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}
      {section.reviewed ? "All viewed" : "Mark all viewed"}
    </button>
  );
}

// Render right after the group's header: the trigger marks where the header slides under the bar.
export function GroupBar({ number, title, onTitle, children }: {
  number: string; title: string; onTitle: () => void; children: ReactNode;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = trigger.current!;
    const update = () => setShown(element.getBoundingClientRect().top < 0);
    // A jump can carry the trigger from below the window to above it without crossing, which the observer never reports.
    const observer = new IntersectionObserver(update);
    observer.observe(element);
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      observer.disconnect();
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, []);
  return <>
    <div className="group-bar-trigger" ref={trigger} />
    {/* A pointer shortcut only: keyboard and screen reader users have the header, so clicks here leave focus alone. */}
    <div className={`group-bar${shown ? " shown" : ""}`} aria-hidden="true" onMouseDown={(event) => event.preventDefault()}>
      <div className="group-bar-inner">
        <button className="group-bar-title" tabIndex={-1} title="Go to the top of this group" onClick={onTitle}>
          <span className="group-number">{number}</span>
          <span className="group-bar-name">{title}</span>
        </button>
        {children}
      </div>
    </div>
  </>;
}
