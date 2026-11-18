import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function BriefDialog({ title, children, onClose, wide = false, busy = false, fullscreen = false, leading, actions }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; busy?: boolean; fullscreen?: boolean; leading?: React.ReactNode; actions?: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const trigger = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>("textarea:not([readonly]), input")?.focus();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog className={`brief-dialog${fullscreen ? " source-dialog" : wide ? " wide" : ""}`} ref={dialog}
    aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="brief-dialog-heading">{leading}<h2 title={title}>{title}</h2>{actions}<button disabled={busy} aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18} /></button></div>
    {children}
  </dialog>, document.body);
}
