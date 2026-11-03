import { CloseCode, RelayCloseError, type SessionLink, type WebSocketLink } from "@doriface/relay-client";
import { AsyncQueue } from "./queue.ts";

export function received(link: SessionLink | WebSocketLink): AsyncQueue<Uint8Array> {
  const queue = new AsyncQueue<Uint8Array>();
  link.onData((bytes) => queue.push(bytes));
  link.onClose((error) => queue.end(error ?? new Error("link closed")));
  return queue;
}

function closeCodeOf(error: Error | undefined): number | undefined {
  return error instanceof RelayCloseError ? error.code : error === undefined ? CloseCode.Normal : undefined;
}

export const closedWith = (link: SessionLink | WebSocketLink): Promise<number | undefined> =>
  new Promise((resolve) => link.onClose((error) => resolve(closeCodeOf(error))));
