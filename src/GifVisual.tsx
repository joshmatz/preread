import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import { frameAt, type GifInfo, type GifReply, type GifRequest } from "./gif-frames";
import type { Size } from "./visual-viewport";

const timeLabel = (ms: number) => `${Math.floor(ms / 60_000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, "0")}`;

export default function GifVisual({ src, title, style, onSize, onError }: {
  src: string; title: string; style: CSSProperties; onSize: (size: Size) => void; onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState<GifInfo | null>(null);
  const [position, setPosition] = useState(0);
  const [rendered, setRendered] = useState(-1);
  const [playing, setPlaying] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const worker = useRef<Worker | null>(null);
  const wanted = useRef(0);
  const pending = useRef(false);
  const drawn = useRef(-1);
  useEffect(() => {
    const abort = new AbortController();
    const decoder = new Worker(new URL("./gif-frames.worker.ts", import.meta.url), { type: "module" });
    worker.current = decoder;
    const requestFrame = (index: number) => {
      pending.current = true;
      decoder.postMessage({ kind: "frame", index } satisfies GifRequest);
    };
    decoder.onmessage = (event: MessageEvent<GifReply>) => {
      const message = event.data;
      if (message.kind === "error") { onError(message.message); return; }
      if (message.kind === "ready") {
        if (!canvas.current) return;
        canvas.current.width = message.info.width; canvas.current.height = message.info.height;
        setInfo(message.info);
        requestFrame(0);
      } else {
        const context = canvas.current?.getContext("2d");
        if (!context || !canvas.current) { onError("Your browser couldn’t display the GIF canvas."); return; }
        context.putImageData(new ImageData(message.pixels, canvas.current.width, canvas.current.height), 0, 0);
        if (drawn.current === -1) onSize({ width: canvas.current.width, height: canvas.current.height });
        drawn.current = message.index;
        setRendered(message.index);
        pending.current = false;
        if (message.index !== wanted.current) requestFrame(wanted.current);
      }
    };
    decoder.onerror = () => onError("Couldn’t decode this GIF. Try loading it again.");
    void fetch(src, { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Couldn’t load this GIF. Try loading it again.");
      const data = await response.arrayBuffer();
      if (!abort.signal.aborted) decoder.postMessage({ kind: "load", data } satisfies GifRequest, [data]);
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) onError(cause instanceof Error ? cause.message : "Couldn’t load this GIF.");
    });
    return () => { abort.abort(); decoder.terminate(); worker.current = null; };
  }, [src, onSize, onError]);
  const index = info ? frameAt(info.ends, position) : 0;
  useEffect(() => {
    wanted.current = index;
    if (info && worker.current && !pending.current && drawn.current !== index) {
      pending.current = true;
      worker.current.postMessage({ kind: "frame", index } satisfies GifRequest);
    }
  }, [index, info]);
  useEffect(() => {
    if (!playing || !info || info.ends.length === 1) return;
    let animation = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = document.hidden ? 0 : now - last;
      last = now;
      setPosition((time) => (time + elapsed) % info.duration);
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, info]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  return <>
    <canvas ref={canvas} role="img" aria-label={title} aria-busy={rendered !== index} style={style} />
    {info && info.ends.length > 1 && <div className="gif-playback" role="group" aria-label="GIF playback"
      onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <button aria-label={playing ? "Pause GIF" : "Play GIF"} title={playing ? "Pause GIF" : "Play GIF"}
        onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
      <input type="range" aria-label="GIF timeline" min={0} max={info.duration} step={10} value={position}
        aria-valuetext={`${timeLabel(position)} of ${timeLabel(info.duration)}`}
        onPointerDown={() => setPlaying(false)}
        onChange={(event) => { setPlaying(false); setPosition(Number(event.currentTarget.value)); }} />
      <output aria-label="GIF time">{timeLabel(position)} / {timeLabel(info.duration)}</output>
    </div>}
  </>;
}
