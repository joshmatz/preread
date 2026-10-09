export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };
export const MIN_ZOOM = 0.001;
export const MAX_ZOOM = 16;
export function fitVisual(image: Size, stage: Size): View {
  const scale = Math.min(1, Math.max(MIN_ZOOM, Math.min(
    Math.max(1, stage.width - 48) / Math.max(1, image.width),
    Math.max(1, stage.height - 48) / Math.max(1, image.height))));
  return { scale, x: 0, y: 0 };
}
// Preserve the image point under the pointer when zooming or pinching.
export function zoomVisual(view: View, scale: number, point = { x: 0, y: 0 }): View {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  const ratio = next / view.scale;
  return { scale: next, x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio };
}
