import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

// The panel sits in the top layer, so a Picker opened inside it would render underneath.
export function Popover({
  label,
  width,
  className,
  title,
  hover = false,
  panel,
  children,
}: {
  label: string;
  width: number;
  className: string;
  title?: string;
  hover?: boolean;
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
    if (!hover) return;
    const panel = element.current!;
    const button = trigger.current!;
    const targets: HTMLElement[] = [button, panel];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered = false;
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Showing this panel would close any other open popover.
        if (document.querySelector(":popover-open")) return;
        hovered = true;
        panel.showPopover();
      }, 300);
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(timer);
      if (hovered) timer = setTimeout(() => panel.hidePopover(), 200);
    };
    // A click on a panel that hover opened keeps it open instead of toggling it closed.
    const pin = (event: MouseEvent) => {
      clearTimeout(timer);
      if (!hovered) return;
      hovered = false;
      event.preventDefault();
    };
    const closed = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") hovered = false;
    };
    for (const target of targets) {
      target.addEventListener("pointerenter", enter);
      target.addEventListener("pointerleave", leave);
    }
    button.addEventListener("click", pin);
    panel.addEventListener("toggle", closed);
    return () => {
      clearTimeout(timer);
      for (const target of targets) {
        target.removeEventListener("pointerenter", enter);
        target.removeEventListener("pointerleave", leave);
      }
      button.removeEventListener("click", pin);
      panel.removeEventListener("toggle", closed);
    };
  }, [hover]);
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
        title={hover ? undefined : title}
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
