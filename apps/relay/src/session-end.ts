import { encodeClose, CloseCode, sendableCloseCode } from "@doriface/relay-client/wire";
import { type ClientAttachment, patchClient, patchHost } from "./attachment.ts";
import { sendControl } from "./flow.ts";
import { closeIfOpen, liveClients, onlineHost } from "./sockets.ts";

/** Ends a session without telling the host: the host closed it, or the host is gone. */
export function endClient(ws: WebSocket, code: number, reason: string): void {
  patchClient(ws, { ended: true });
  closeIfOpen(ws, sendableCloseCode(code), reason);
}

/** Ends a session from the relay's side and tells the host with a CLOSE frame. */
export function endSession(
  ctx: DurableObjectState,
  ws: WebSocket,
  session: ClientAttachment,
  code: number,
  reason: string,
): void {
  endClient(ws, code, reason);
  const host = onlineHost(ctx);
  if (host !== undefined) sendControl(host, encodeClose(session.sessionId, code));
}

/** Takes an uplink offline: every live session ends with 4404 and the socket closes with `code`. */
export function dropHost(ctx: DurableObjectState, ws: WebSocket, code: number, reason: string): void {
  patchHost(ws, { state: "replaced" });
  for (const { ws: client } of liveClients(ctx)) endClient(client, CloseCode.HostOffline, "host offline");
  closeIfOpen(ws, code, reason);
}
