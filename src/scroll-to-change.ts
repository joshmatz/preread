const navigationKeys = new Set([
  "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab", "Enter", "Escape",
]);

export function scrollToChange(target: HTMLElement): () => void {
  let stopped = false;
  const align = () => {
    if (stopped) return;
    if (!target.isConnected) {
      stop();
      return;
    }
    target.scrollIntoView({ block: "start", behavior: "instant" });
  };
  const observer = new ResizeObserver(align);
  const onKeyDown = (event: KeyboardEvent) => {
    if (navigationKeys.has(event.key)) stop();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.removeEventListener("wheel", stop, true);
    window.removeEventListener("touchstart", stop, true);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };

  // Lazy diffs and images above the destination can grow after the initial scroll.
  observer.observe(target.closest(".review-feed") ?? target);
  window.addEventListener("wheel", stop, { capture: true, passive: true });
  window.addEventListener("touchstart", stop, { capture: true, passive: true });
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("keydown", onKeyDown, true);
  align();
  return stop;
}
