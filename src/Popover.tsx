import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

// The panel sits in the top layer, so a Picker opened inside it would render underneath.
export function Popover({
  label,
  width,
  className,
  title,
  panel,
  children,
}: {
  label: string;
  width: number;
  className: string;
  title?: string;
  panel: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const element = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = () => {
    const bounds = trigger.current!.getBoundingClientRect();
    const size = Math.min(width, innerWidth - 24);
    Object.assign(element.current!.style, {
      width: `${size}px`,
      left: `${Math.max(12, Math.min(bounds.right - size, innerWidth - size - 12))}px`,
      top: `${bounds.bottom + 6}px`,
      maxHeight: `${Math.max(160, innerHeight - bounds.bottom - 18)}px`,
    });
  };
  useEffect(() => {
    const panel = element.current!;
    const button = trigger.current!;
    const before = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      place();
      // Render the contents before the browser paints the panel.
      flushSync(() => setOpen(true));
    };
    const after = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") setOpen(false);
    };
    // Light dismiss ignores keyboard focus, which can reach a Picker that would open underneath.
    const leave = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!panel.matches(":popover-open") || !next) return;
      if (!panel.contains(next) && !button.contains(next)) panel.hidePopover();
    };
    panel.addEventListener("beforetoggle", before);
    panel.addEventListener("toggle", after);
    panel.addEventListener("focusout", leave);
    button.addEventListener("focusout", leave);
    return () => {
      panel.removeEventListener("beforetoggle", before);
      panel.removeEventListener("toggle", after);
      panel.removeEventListener("focusout", leave);
      button.removeEventListener("focusout", leave);
    };
  }, [width]);
  useEffect(() => {
    if (!open) return;
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [open, width]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        popoverTarget={id}
      >
        {children}
      </button>
      <div ref={element} id={id} popover="auto" role="dialog" aria-label={label} className="popover">
        {open && panel(() => element.current?.hidePopover())}
      </div>
    </>
  );
}
