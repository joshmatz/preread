// Keep Mermaid out of the reading-view bundle and render only the active attachment.
export function validateMermaid(source: string) {
  if (source.length > 65536) throw new Error("This Mermaid diagram is too large.");
  if (/%%\s*\{|^\s*---|(?:https?:|data:|javascript:|file:|ftp:|\/\/)/im.test(source))
    throw new Error("Mermaid attachments must use local diagram text without external resources or configuration directives.");
}
export async function mermaidVisual(source: string): Promise<string> {
  validateMermaid(source);
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false,
    suppressErrorRendering: true, fontFamily: "Arial, sans-serif", theme: "default",
    maxTextSize: 65536, secure: ["securityLevel", "htmlLabels", "fontFamily", "maxTextSize", "secure"] });
  let svg: string;
  try { ({ svg } = await mermaid.render(`visual-${crypto.randomUUID()}`, source)); }
  catch { throw new Error("This Mermaid diagram couldn’t be rendered. Ask your agent to check its syntax."); }
  // Mermaid emits width="100%"; give the image actual diagram dimensions so Fit and 100% are meaningful.
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  const bounds = root.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  if (bounds?.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0) {
    root.setAttribute("width", String(bounds[2])); root.setAttribute("height", String(bounds[3]));
    (root as unknown as SVGElement).style.removeProperty("max-width");
  }
  // The output remains an image: no HTML insertion, event bindings or clickable links.
  return URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }));
}
