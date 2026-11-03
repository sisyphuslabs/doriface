import { HcConnection, type ByteLink } from "@doriface/client";
import { type ConnectionSettings, relayClientUrl } from "./settings.ts";
import { loadDeviceKey } from "./device-key.ts";
import { openWebSocketLink, RELAY_PING_MS } from "./ws-link.ts";

const SUBPROTOCOL = "doriface.v1";
const TOKEN_PREFIX = "doriface.token.";

/** The relay and direct paths need the Noise record layer, which this build does not ship yet. */
export class EncryptionUnavailableError extends Error {
  override readonly name = "EncryptionUnavailableError";
  readonly target: string;
  constructor(target: string) {
    super(`end-to-end encryption is not available in this build, so ${target} cannot be reached`);
    this.target = target;
  }
}

/** Opens a framed herdr-core connection with the given settings. */
export async function connect(settings: ConnectionSettings, signal?: AbortSignal): Promise<HcConnection> {
  if (settings.mode === "relay") throw new EncryptionUnavailableError(relayClientUrl(settings));
  const link = await openWebSocketLink(settings.loopbackUrl, [SUBPROTOCOL, TOKEN_PREFIX + settings.token]);
  return HcConnection.open(link, signal === undefined ? {} : { signal });
}

/**
 * A relay client socket: binary only, plus the `ping` text the relay's 90 s reaper expects (contract
 * v1.2 C6). The device key is loaded for the Noise handshake. The record layer that wraps this link owns
 * the `a:<total bytes received>` text acks every 64 KiB (docs/transport.md); without them the relay
 * closes the socket once 4 MiB is unacknowledged.
 */
export async function openRelayLink(url: string): Promise<ByteLink> {
  await loadDeviceKey();
  return openWebSocketLink(url, [], { pingEveryMs: RELAY_PING_MS });
}
