import { sendableCloseCode } from "./wire/index.ts";

/** Creates the WebSocket for a relay URL; injectable so tests and other runtimes can supply their own. */
export type CreateSocket = (url: string) => WebSocket;

export const defaultCreateSocket: CreateSocket = (url) => new WebSocket(url);

const OPEN = 1;

export function isOpen(ws: WebSocket): boolean {
  return ws.readyState === OPEN;
}

/**
 * Closes with `code` if a WebSocket client may send it (1000 or 3000-4999), else with 1000; browsers throw for
 * the other codes. The local side still reports the real code.
 */
export function closeSocket(ws: WebSocket, code: number, reason: string): void {
  ws.close(sendableCloseCode(code), reason);
}

/** `https://relay.example` + `/v1/host/<id>` -> `wss://relay.example/v1/host/<id>`. */
export function relaySocketUrl(relayUrl: string, path: string): string {
  const url = new URL(path, relayUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:")
    throw new Error(`relay URL must be http(s) or ws(s): ${relayUrl}`);
  return url.toString();
}
