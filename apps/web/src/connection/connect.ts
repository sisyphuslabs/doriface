import { HcConnection } from "@doriface/client";
import { type ConnectionSettings, relayClientUrl } from "./settings.ts";
import { openWebSocketLink } from "./ws-link.ts";

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
