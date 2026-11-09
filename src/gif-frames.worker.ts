import { gifFrames, type GifRequest, type GifReply } from "./gif-frames";

let gif: ReturnType<typeof gifFrames> | undefined;
const reply = (message: GifReply, transfer: Transferable[] = []) => postMessage(message, { transfer });
self.onmessage = (event: MessageEvent<GifRequest>) => {
  try {
    const message = event.data;
    if (message.kind === "load") {
      gif = gifFrames(message.data);
      reply({ kind: "ready", info: gif.info });
    } else if (gif) {
      const pixels = gif.render(message.index);
      reply({ kind: "frame", index: message.index, pixels }, [pixels.buffer]);
    }
  } catch (cause) {
    reply({ kind: "error", message: cause instanceof Error ? cause.message : "Couldn’t decode this GIF." });
  }
};
