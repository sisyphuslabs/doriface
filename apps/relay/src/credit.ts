import {
  ACK_INTERVAL_BYTES,
  CloseCode,
  CREDIT_QUERY,
  encodeCredit,
  encodeCreditText,
} from "@doriface/relay-client/wire";
import { type Attachment, attachmentOf, type ClientAttachment, patchClient } from "./attachment.ts";
import { applyAck, sendControl } from "./flow.ts";
import { clientSocket, isOpen, onlineHost } from "./sockets.ts";

export const asksForCredit = (url: URL): boolean => url.searchParams.get(CREDIT_QUERY[0]) === CREDIT_QUERY[1];

export function hostServesCredit(host: WebSocket): boolean {
  const attachment = attachmentOf(host);
  return attachment?.role === "host" && attachment.credit === true;
}

/** Right after OPEN: a zero credit tells a credit host, and `c:0` a credit client, that credit flows. */
export function openCredit(host: WebSocket, client: WebSocket, session: ClientAttachment): void {
  if (!hostServesCredit(host)) return;
  sendControl(host, encodeCredit(session.sessionId, 0));
  if (session.credit === true && isOpen(client)) client.send(encodeCreditText(0));
}

export function forwardedToHost(host: WebSocket, client: WebSocket, session: ClientAttachment, bytes: number): void {
  if (hostServesCredit(host)) patchClient(client, { toHost: (session.toHost ?? 0) + bytes });
}

/** A host's CREDIT: refused unless it asked for credit and credits no more than the relay forwarded. */
export function creditFromHost(ctx: DurableObjectState, host: WebSocket, sessionId: number, bytes: number): void {
  if (!hostServesCredit(host)) return host.close(CloseCode.RelayProtocolError, "CREDIT without ?credit=1");
  const client = clientSocket(ctx, sessionId);
  const session = client === undefined ? undefined : attachmentOf(client);
  // A session the relay or the client just ended: the host's credit for it no longer matters.
  if (client === undefined || session?.role !== "client" || session.ended) return;
  const credited = (session.hostCredited ?? 0) + bytes;
  if (credited > (session.toHost ?? 0)) return host.close(CloseCode.RelayProtocolError, "credit for unsent bytes");
  const pending = (session.creditPending ?? 0) + bytes;
  const due = pending >= ACK_INTERVAL_BYTES || (pending > 0 && credited === session.toHost);
  patchClient(client, { hostCredited: credited, creditPending: due ? 0 : pending });
  if (session.credit === true && due) client.send(encodeCreditText(pending));
}

/** Text from either side: an `a:<n>` ack; a client's ack also becomes CREDIT for a credit host. */
export function textFrom(ctx: DurableObjectState, ws: WebSocket, before: Attachment, text: string): void {
  if (!applyAck(ws, text)) return ws.close(CloseCode.RelayProtocolError, "binary messages, pings and valid acks only");
  const after = attachmentOf(ws);
  if (before.role !== "client" || after === undefined) return;
  const host = onlineHost(ctx);
  const consumed = after.acked - before.acked;
  if (host !== undefined && consumed > 0 && hostServesCredit(host)) {
    sendControl(host, encodeCredit(before.sessionId, consumed));
  }
}
