import { CloseCode, RelayCloseError, type SessionLink, type WebSocketLink } from "@doriface/relay-client";
import { AsyncQueue } from "./queue.ts";

export function received(link: SessionLink | WebSocketLink): AsyncQueue<Uint8Array> {
  const queue = new AsyncQueue<Uint8Array>();
  link.onData((bytes) => queue.push(bytes));
  link.onClose((error) => queue.end(error ?? new Error("link closed")));
  return queue;
}

/** The link's close code; any failure other than a relay close rejects with that error so the test shows it. */
export const closedWith = (link: SessionLink | WebSocketLink): Promise<number> =>
  new Promise((resolve, reject) =>
    link.onClose((error) => {
      if (error === undefined) resolve(CloseCode.Normal);
      else if (error instanceof RelayCloseError) resolve(error.code);
      else reject(error);
    }),
  );
