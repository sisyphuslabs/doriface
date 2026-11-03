import { type Attachment, attachmentOf } from "./attachment.ts";

export const HOST_TAG = "host";
export const CLIENT_TAG = "client";
export const sessionTag = (sessionId: number): string => `s:${sessionId}`;

const OPEN = 1;
const CLOSED = 3;

export function isOpen(ws: WebSocket): boolean {
  return ws.readyState === OPEN;
}

/** Sends if the socket is still open; a peer that is mid-close simply misses the message. */
export function sendIfOpen(ws: WebSocket, bytes: Uint8Array<ArrayBuffer>): void {
  if (isOpen(ws)) ws.send(bytes);
}

export function closeIfOpen(ws: WebSocket, code: number, reason: string): void {
  if (isOpen(ws)) ws.close(code, reason);
}

/** Answers a peer's close frame; without it the peer's close handshake never completes. */
export function completeClose(ws: WebSocket, code: number): void {
  if (ws.readyState !== CLOSED) ws.close(code, "");
}

export function withAttachment(ctx: DurableObjectState, tag: string): { ws: WebSocket; attachment: Attachment }[] {
  return ctx.getWebSockets(tag).flatMap((ws) => {
    const attachment = attachmentOf(ws);
    return attachment === undefined ? [] : [{ ws, attachment }];
  });
}

export function onlineHost(ctx: DurableObjectState): WebSocket | undefined {
  return withAttachment(ctx, HOST_TAG).find(
    ({ ws, attachment }) => attachment.role === "host" && attachment.state === "online" && isOpen(ws),
  )?.ws;
}

export function openClients(ctx: DurableObjectState): WebSocket[] {
  return ctx.getWebSockets(CLIENT_TAG).filter(isOpen);
}

export function clientSocket(ctx: DurableObjectState, sessionId: number): WebSocket | undefined {
  return ctx.getWebSockets(sessionTag(sessionId)).find(isOpen);
}

/** A random u32 that no live session uses, so ids stay unique across hibernation without stored counters. */
export function freshSessionId(ctx: DurableObjectState): number {
  const [id = 0] = crypto.getRandomValues(new Uint32Array(1));
  return ctx.getWebSockets(sessionTag(id)).length === 0 ? id : freshSessionId(ctx);
}

export function newSocketPair(): { readonly client: WebSocket; readonly server: WebSocket } {
  const [client, server] = Object.values(new WebSocketPair());
  if (client === undefined || server === undefined) throw new Error("WebSocketPair has no ends");
  return { client, server };
}
