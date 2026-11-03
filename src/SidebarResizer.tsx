import { useEffect, useLayoutEffect, useRef, useState } from "react";

const storageKey = "sidebarWidth";
const minWidth = 180;
const savedWidth = () => {
  try {
    return Number(localStorage.getItem(storageKey)) || null;
  } catch {
    return null;
  }
};

// Must directly follow the sidebar in the grid whose --sidebar-width it sets.
export function SidebarResizer() {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);
  const [width, setWidth] = useState(savedWidth);
  const [dragging, setDragging] = useState(false);
  const [column, setColumn] = useState({ width: 0, max: 0 });
  const measure = () => ({
    width: Math.round(handle.current!.previousElementSibling!.getBoundingClientRect().width),
    max: Math.floor(handle.current!.parentElement!.clientWidth / 2),
  });
  const resize = (next: number, max: number) =>
    setWidth(Math.round(Math.max(minWidth, Math.min(max, next))));
  useLayoutEffect(() => {
    handle.current!.parentElement!.style.setProperty(
      "--sidebar-width",
      width === null ? null : `${width}px`,
    );
    setColumn(measure());
  }, [width]);
  useEffect(() => {
    const update = () => setColumn(measure());
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    if (dragging) return;
    try {
      if (width === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(width));
    } catch {
      /* The width lasts until reload when browser storage is disabled. */
    }
  }, [width, dragging]);
  return (
    <div
      ref={handle}
      className={`sidebar-resizer${dragging ? " dragging" : ""}`}
      role="separator"
      aria-label="Resize file outline"
      aria-description="Drag or use arrow keys to resize. Enter or a double-click restores the default width."
      aria-orientation="vertical"
      aria-valuenow={column.width}
      aria-valuemin={minWidth}
      aria-valuemax={column.max}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, ...measure() };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) resize(start.width + event.clientX - start.x, start.max);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        const direction = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "Enter") setWidth(null);
        else if (direction) {
          event.preventDefault();
          const { width, max } = measure();
          resize(width + direction * (event.shiftKey ? 64 : 16), max);
        }
      }}
      onDoubleClick={() => setWidth(null)}
    />
  );
}
