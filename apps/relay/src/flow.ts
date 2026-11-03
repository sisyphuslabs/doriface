import { CloseCode, MAX_UNACKED_BYTES, parseAck, SESSION_WINDOW_BYTES } from "@doriface/relay-client/wire";
import { MAX_ACTIVE_SESSIONS, MAX_PENDING_SESSIONS } from "./admission.ts";
import { type Attachment, attach, attachmentOf } from "./attachment.ts";

/** Every session to a credit uplink keeps at most a window in flight, so the uplink may hold all of them at once. */
export const CREDIT_HOST_UNACKED =
  MAX_UNACKED_BYTES + (MAX_ACTIVE_SESSIONS + MAX_PENDING_SESSIONS) * SESSION_WINDOW_BYTES;
import { closeIfOpen, isOpen } from "./sockets.ts";

function sendCounted(ws: WebSocket, attachment: Attachment, bytes: Uint8Array<ArrayBuffer>): void {
  if (!isOpen(ws)) return;
  attach(ws, { ...attachment, sent: attachment.sent + bytes.byteLength });
  ws.send(bytes);
}

/**
 * Forwards payload bytes unless the receiver would then hold more than 4 MiB unacked (contract v1.2 C3). False means
 * nothing was sent and the receiver is too far behind.
 */
export function forward(ws: WebSocket, bytes: Uint8Array<ArrayBuffer>): boolean {
  const attachment = attachmentOf(ws);
  if (attachment === undefined) return false;
  const cap = attachment.role === "host" && attachment.credit === true ? CREDIT_HOST_UNACKED : MAX_UNACKED_BYTES;
  if (attachment.sent + bytes.byteLength - attachment.acked > cap) return false;
  sendCounted(ws, attachment, bytes);
  return true;
}

/**
 * Sends a relay message of its own (challenge, OPEN, CLOSE, PAIR_SLOT reply) under the same window: a peer so far
 * behind that it cannot take one more is closed with 4408 instead of queueing without bound.
 */
export function sendControl(ws: WebSocket, bytes: Uint8Array<ArrayBuffer>): void {
  if (!forward(ws, bytes)) closeIfOpen(ws, CloseCode.IdleTimeout, "the receiver is too far behind");
}

/** Applies an `a:<total>` ack; false when it is malformed, goes backwards or acks bytes never sent. */
export function applyAck(ws: WebSocket, text: string): boolean {
  const attachment = attachmentOf(ws);
  const total = parseAck(text);
  if (attachment === undefined || total === undefined) return false;
  if (total < attachment.acked || total > attachment.sent) return false;
  attach(ws, { ...attachment, acked: total });
  return true;
}
