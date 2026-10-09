import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Images, Maximize, Minus, Plus, X } from "lucide-react";
import type { ReviewVisual } from "./review-types";
import { fitVisual, zoomVisual, MIN_ZOOM, MAX_ZOOM, type View, type Size } from "./visual-viewport";

type Scope = { collection: string; review: string; group?: string };
const isMermaid = (visual: ReviewVisual) => /\.(mmd|mermaid)$/i.test(visual.path);
const assetUrl = (visual: ReviewVisual, scope: Scope) => `/api/visuals?${new URLSearchParams({ ...scope, id: visual.id })}`;
function VisualCanvas({ visual, scope }: { visual: ReviewVisual; scope: Scope }) {
  const stage = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [size, setSize] = useState<Size | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl = "";
    setError(""); setSize(null); setSrc("");
    const load = async () => {
      try {
        const url = assetUrl(visual, scope);
        if (!isMermaid(visual)) { setSrc(url); return; }
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error("Couldn’t load this Mermaid diagram.");
        const { mermaidVisual } = await import("./mermaid-visual");
        if (abort.signal.aborted) return;
        objectUrl = await mermaidVisual(await response.text());
        if (abort.signal.aborted) URL.revokeObjectURL(objectUrl);
        else setSrc(objectUrl);
      } catch (cause) {
        if (!abort.signal.aborted) setError((cause as Error).message);
      }
    };
    void load();
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visual.id, visual.path, scope.collection, scope.review, scope.group, attempt]);
  const fit = () => {
    if (size && stage.current) setView(fitVisual(size, stage.current.getBoundingClientRect()));
  };
  useEffect(() => {
    if (!size || !stage.current) return;
    const observer = new ResizeObserver(() => {
      if (stage.current) setView(fitVisual(size, stage.current.getBoundingClientRect()));
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [size]);
  useEffect(() => {
    const element = stage.current;
    if (!element || !size) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2 };
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      setView((old) => zoomVisual(old, old.scale * Math.exp(-Math.max(-160, Math.min(160, delta)) * 0.003), point));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [size]);
  const release = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId); setDragging(pointers.current.size > 0);
  };
  return <>
    <div className={`visual-stage${dragging ? " dragging" : ""}`} ref={stage} role="region"
      aria-label="Visual canvas" aria-description="Scroll or pinch to zoom. Drag or use arrow keys to pan. Home fits the visual." tabIndex={0}
      onKeyDown={(event) => {
        if (!size) return;
        const step = event.shiftKey ? 100 : 40;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
        };
        if (directions[event.key]) {
          event.preventDefault(); const [x, y] = directions[event.key];
          setView((old) => ({ ...old, x: old.x + x, y: old.y + y }));
        } else if (["+", "=", "-", "Home", "0"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "Home" || event.key === "0") fit();
          else setView((old) => zoomVisual(old, old.scale * (event.key === "-" ? 1 / 1.25 : 1.25)));
        }
      }}
      onPointerDown={(event) => {
        if (!size || event.button !== 0) return;
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); setDragging(true);
      }}
      onPointerMove={(event) => {
        const before = pointers.current.get(event.pointerId); if (!before) return;
        const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
        const after = { x: event.clientX, y: event.clientY };
        pointers.current.set(event.pointerId, after);
        if (other && stage.current) {
          const oldDistance = Math.hypot(before.x - other.x, before.y - other.y);
          const newDistance = Math.hypot(after.x - other.x, after.y - other.y);
          const bounds = stage.current.getBoundingClientRect();
          const oldCenter = { x: (before.x + other.x) / 2 - bounds.left - bounds.width / 2,
            y: (before.y + other.y) / 2 - bounds.top - bounds.height / 2 };
          setView((old) => {
            const next = zoomVisual(old, old.scale * newDistance / Math.max(1, oldDistance), oldCenter);
            return { ...next, x: next.x + (after.x - before.x) / 2, y: next.y + (after.y - before.y) / 2 };
          });
        } else setView((old) => ({ ...old, x: old.x + after.x - before.x, y: old.y + after.y - before.y }));
      }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      {!size && !error && <p className="visual-status" role="status">{isMermaid(visual) ? "Rendering diagram…" : "Loading visual…"}</p>}
      {error && <div className="visual-error" role="alert"><p>{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
      {src && !error && <img src={src} alt={visual.title} draggable={false}
        style={{ width: size?.width, height: size?.height, visibility: size ? "visible" : "hidden",
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        onLoad={(event) => {
          const image = event.currentTarget;
          const next = { width: image.naturalWidth, height: image.naturalHeight };
          setSize(next); if (stage.current) setView(fitVisual(next, stage.current.getBoundingClientRect()));
        }} onError={() => setError("Couldn’t display this visual. Ask your agent to check the attachment.")} />}
    </div>
    <div className="visual-toolbar">
      <div role="group" aria-label="Zoom controls">
        <button aria-label="Zoom out" title="Zoom out (−)" disabled={!size || view.scale <= MIN_ZOOM}
          onClick={() => setView((old) => zoomVisual(old, old.scale / 1.25))}><Minus size={17} /></button>
        <output aria-label="Zoom level">{Math.round(view.scale * 100)}%</output>
        <button aria-label="Zoom in" title="Zoom in (+)" disabled={!size || view.scale >= MAX_ZOOM}
          onClick={() => setView((old) => zoomVisual(old, old.scale * 1.25))}><Plus size={17} /></button>
        <button disabled={!size} title="Fit whole visual (Home)" onClick={fit}><Maximize size={15} /> Fit</button>
        <button disabled={!size} onClick={() => setView({ scale: 1, x: 0, y: 0 })}>100%</button>
      </div>
    </div>
  </>;
}
function VisualGallery({ visuals, scope, onClose }: { visuals: ReviewVisual[]; scope: Scope; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const thumbnails = useRef<HTMLButtonElement>(null);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [selectedId, setSelectedId] = useState(visuals[0].id);
  const selected = Math.max(0, visuals.findIndex((visual) => visual.id === selectedId));
  const visual = visuals[selected];
  useEffect(() => {
    const element = dialog.current!; element.showModal(); close.current?.focus();
    const scroll = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = scroll; };
  }, []);
  return createPortal(<dialog ref={dialog} className="visual-gallery" aria-labelledby="visual-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="visual-gallery-header">
      <div className="visual-gallery-title" title={visual.title}><h2 id="visual-title">{visual.title}</h2></div>
      <div className="visual-gallery-actions">
        {visuals.length > 1 && <>
          <button ref={thumbnails} aria-label={showThumbnails ? "Hide thumbnails" : "Show thumbnails"}
            title="Browse visuals" aria-expanded={showThumbnails} aria-controls="visual-thumbnails"
            onClick={() => setShowThumbnails(!showThumbnails)}><Images size={18} /></button>
          <span className="visual-position" aria-label={`Visual ${selected + 1} of ${visuals.length}`}>{selected + 1}/{visuals.length}</span>
          <button aria-label="Previous visual" disabled={selected === 0} onClick={() => setSelectedId(visuals[selected - 1].id)}><ChevronLeft size={20} /></button>
          <button aria-label="Next visual" disabled={selected === visuals.length - 1} onClick={() => setSelectedId(visuals[selected + 1].id)}><ChevronRight size={20} /></button>
        </>}
        <button ref={close} aria-label="Close visual gallery" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    <VisualCanvas key={`${visual.id}|${visual.path}`} visual={visual} scope={scope} />
    {visuals.length > 1 && showThumbnails && <nav id="visual-thumbnails" className="visual-filmstrip" aria-label="Visual gallery">
      {visuals.map((entry, index) => <button key={entry.id} aria-current={selected === index ? "true" : undefined}
        aria-label={`Show ${entry.title}`} onClick={() => { setSelectedId(entry.id); setShowThumbnails(false); thumbnails.current?.focus(); }}>
        {isMermaid(entry) ? <span className="mermaid-thumbnail"><Images size={24} />Mermaid</span>
          : <img src={assetUrl(entry, scope)} alt="" loading="lazy" />}
        <span>{entry.title}</span>
      </button>)}
    </nav>}
  </dialog>, document.body);
}
export function ReviewVisuals({ visuals = [], collection, review, group }: Scope & { visuals?: ReviewVisual[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!visuals.length) return null;
  return <div className="review-visuals">
    <button className="visuals-launch" ref={trigger} aria-haspopup="dialog"
      title={visuals.map((visual) => visual.title).join(" · ")}
      aria-label={`Open ${group ? "group" : "review"} visual gallery, ${visuals.length} ${visuals.length === 1 ? "visual" : "visuals"}`}
      onClick={() => setOpen(true)}><Images size={16} />Visuals <span className="pill">{visuals.length}</span></button>
    {open && <VisualGallery visuals={visuals} scope={{ collection, review, ...(group ? { group } : {}) }}
      onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }} />}
  </div>;
}
