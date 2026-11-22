import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ListTree } from "lucide-react";
import { SidebarResizer } from "./SidebarResizer";

export type Drawer = { onClose?: () => void; shut: () => void };

// Below 1180px the rail is a drawer: a rail link calls `shut` before it moves the page or focus.
export function ReviewFrame({ className, rail, eyebrow, title, summary, tabs, children }: {
  className?: string; rail: (drawer: Drawer) => ReactNode; eyebrow: ReactNode; title: ReactNode;
  summary?: ReactNode; tabs?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  // The page stays inert until the closed drawer renders, and focus() on an inert element silently does nothing.
  const shut = () => { if (open) flushSync(() => setOpen(false)); };
  const close = () => { shut(); toggle.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    const rail = open ? document.getElementById("brief-contents") : null;
    if (!rail) return;
    const item = ["[aria-current=location]", "[aria-current=page]", "button"].map((selector) => rail.querySelector<HTMLElement>(selector)).find(Boolean);
    item?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") trapFocus(rail, event);
    };
    const wide = window.matchMedia("(min-width: 1180px)");
    const change = () => { if (wide.matches) setOpen(false); };
    document.addEventListener("keydown", key);
    wide.addEventListener("change", change);
    return () => {
      document.removeEventListener("keydown", key);
      wide.removeEventListener("change", change);
    };
  }, [open]);
  return <div className={`feature-brief${open ? " contents-open" : ""}${className ? ` ${className}` : ""}`}>
    {rail({ onClose: open ? close : undefined, shut })}
    <SidebarResizer storageKey="contentsWidth" label="Resize contents" />
    {open && <div className="brief-contents-backdrop" aria-hidden="true" onClick={close} />}
    <div className="brief-body" inert={open || undefined}>
      <header className="feature-brief-heading">
        <button className="brief-contents-toggle" ref={toggle} aria-expanded={open} aria-controls="brief-contents" onClick={() => setOpen((value) => !value)}><ListTree size={15} />Contents</button>
        <div className="brief-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {summary}
        {tabs}
      </header>
      {children}
    </div>
  </div>;
}

function trapFocus(rail: HTMLElement, event: KeyboardEvent) {
  const items = [...rail.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = rail.contains(document.activeElement);
  if (!inside || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
