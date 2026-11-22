import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function BriefDialog({ title, children, onClose, wide = false, busy = false, fullscreen = false, leading, heading, actions, closeLabel, onDropFiles }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; busy?: boolean; fullscreen?: boolean;
  leading?: React.ReactNode; heading?: React.ReactNode; actions?: React.ReactNode; closeLabel?: string; onDropFiles?: (files: File[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dragDepth = useRef(0);
  const [dropping, setDropping] = useState(false);
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
  // The dialog element also receives drops on its title, padding and backdrop. A file dropped where nothing takes it opens in place of the page.
  const carriesFiles = (event: React.DragEvent) => onDropFiles !== undefined && event.dataTransfer.types.includes("Files");
  return createPortal(<dialog className={`brief-dialog${fullscreen ? " source-dialog" : wide ? " wide" : ""}${dropping && !busy ? " dropping" : ""}`} ref={dialog}
    aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onDragEnter={(event) => { if (carriesFiles(event)) { dragDepth.current++; setDropping(true); } }}
    onDragLeave={(event) => { if (carriesFiles(event) && --dragDepth.current === 0) setDropping(false); }}
    onDragOver={(event) => { if (carriesFiles(event)) event.preventDefault(); }}
    onDrop={(event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault(); dragDepth.current = 0; setDropping(false);
      onDropFiles?.([...event.dataTransfer.files]);
    }}>
    <div className="brief-dialog-heading">
      {leading}{heading ?? <h2 title={title}>{title}</h2>}{actions}
      <button disabled={busy} aria-label={closeLabel ?? `Close ${title.toLowerCase()}`} onClick={onClose}><X size={18} /></button>
    </div>
    {children}
  </dialog>, document.body);
}
