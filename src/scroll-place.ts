import { useEffect, type DependencyList } from "react";

const inputs = ["wheel", "touchmove", "keydown"] as const;

// At the end of the page, whatever is left above the bottom edge counts, since it can't scroll any higher.
export function reached(element: Element | null | undefined) {
  const top = element?.getBoundingClientRect().top;
  if (top === undefined) return false;
  const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  return top <= 140 || (atEnd && top < window.innerHeight - 80);
}

export function onScreen(element: Element | null | undefined) {
  const top = element?.getBoundingClientRect().top;
  return top !== undefined && top >= 0 && top < window.innerHeight;
}

// `place` keeps the reader's place current after each scroll. A place they jumped to stays theirs until they scroll by hand,
// which calls `release`, because one near the end of the page can't reach the top.
export function useScrollPlace(enabled: boolean, place: () => void, release: () => void, deps: DependencyList) {
  useEffect(() => {
    if (!enabled) { release(); return; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    update();
    inputs.forEach((name) => window.addEventListener(name, release, { passive: true }));
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      inputs.forEach((name) => window.removeEventListener(name, release));
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled, ...deps]);
}
