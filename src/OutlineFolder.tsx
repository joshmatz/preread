import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Folder } from "lucide-react";
import { useHoverCard, WrappablePath } from "./HoverCard";
import { fitPath } from "./outline-folders";

let canvas: CanvasRenderingContext2D | null = null;

export function OutlineFolder({ path, children }: { path: string; children: ReactNode }) {
  const label = useRef<HTMLSpanElement>(null);
  const hoverCard = useHoverCard();
  useLayoutEffect(() => {
    const element = label.current!;
    const style = getComputedStyle(element);
    const observer = new ResizeObserver(([entry]) => {
      const context = (canvas ??= document.createElement("canvas").getContext("2d")!);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      element.textContent = fitPath(path, entry.contentRect.width, (text) => context.measureText(text).width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [path]);
  return (
    <div className="outline-folder">
      <div
        className="folder-item"
        aria-hidden="true"
        {...hoverCard(() => {
          const text = label.current;
          const shortened =
            text && (text.textContent !== path || text.scrollWidth > text.clientWidth);
          return (
            shortened && (
              <p className="hover-card-path">
                <WrappablePath path={path} />
              </p>
            )
          );
        })}
      >
        <Folder size={13} />
        <span ref={label} />
      </div>
      {children}
    </div>
  );
}
