import { appendFileSync } from "node:fs";
import { type CreateSocket, decodeMux, MuxType } from "@doriface/relay-client";

/**
 * Records what the relay forwarded, as the two ends receive it: every DATA payload the relay sent the host, and
 * every message it sent the client. Together that is every payload the relay saw in both directions.
 */
export function capturingSockets(file: string, base: CreateSocket): { host: CreateSocket; client: CreateSocket } {
  const record = (bytes: Uint8Array): void => appendFileSync(file, bytes);
  const tap =
    (onMessage: (bytes: Uint8Array, index: number) => void): CreateSocket =>
    (url) => {
      const ws = base(url);
      let index = 0;
      ws.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (event.data instanceof ArrayBuffer) onMessage(new Uint8Array(event.data), index++);
      });
      return ws;
    };
  return {
    // The host socket's first message is the auth challenge, not a mux frame.
    host: tap((bytes, index) => {
      if (index === 0) return;
      const frame = decodeMux(bytes);
      if (frame.type === MuxType.Data) record(frame.payload);
    }),
    client: tap(record),
  };
}
