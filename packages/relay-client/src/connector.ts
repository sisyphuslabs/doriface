import { type CreateSocket, defaultCreateSocket, relaySocketUrl } from "./socket.ts";
import { WebSocketLink } from "./websocket-link.ts";
import { HOST_ID_PATTERN } from "./wire/index.ts";

export interface ClientConnectOptions {
  /** e.g. `https://relay-doriface.omo.dev`. */
  readonly relayUrl: string;
  readonly hostId: string;
  readonly createSocket?: CreateSocket;
}

/**
 * Opens a client session to a host through the relay. Resolves once the socket is open; refusals (4404 host
 * offline, 4429 rate limited) arrive afterwards as the link's close, with the code on the RelayCloseError.
 */
export function connectRelayClient(options: ClientConnectOptions): Promise<WebSocketLink> {
  if (!HOST_ID_PATTERN.test(options.hostId)) return Promise.reject(new Error(`invalid hostId ${options.hostId}`));
  const url = relaySocketUrl(options.relayUrl, `/v1/client/${options.hostId}`);
  const ws = (options.createSocket ?? defaultCreateSocket)(url);
  const link = new WebSocketLink(ws);
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(link), { once: true });
    link.onClose((error) => reject(error ?? new Error(`relay socket to ${url} closed before opening`)));
  });
}
