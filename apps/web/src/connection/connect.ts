import { HcConnection } from "@doriface/client";
import { base64urlDecode, CloseCode, type SecureLink, secureLink, SecureLinkError } from "@doriface/crypto";
import { connectRelayClient } from "@doriface/relay-client";
import { loadDeviceKey } from "./device-key.ts";
import type { ConnectionSettings } from "./settings.ts";
import { openWebSocketLink } from "./ws-link.ts";

const SUBPROTOCOL = "doriface.v1";
const TOKEN_PREFIX = "doriface.token.";

/** The host no longer knows this device (revoked, or its state was reset): retrying cannot help, pairing again can. */
export class DeviceNotPairedError extends Error {
  override readonly name = "DeviceNotPairedError";
  constructor() {
    super("The host does not know this device anymore. Pair it again.");
  }
}

/** Opens a framed herdr-core connection with the given settings. */
export async function connect(settings: ConnectionSettings, signal?: AbortSignal): Promise<HcConnection> {
  const link =
    settings.mode === "relay"
      ? await openRelaySession(settings)
      : await openWebSocketLink(settings.loopbackUrl, [SUBPROTOCOL, TOKEN_PREFIX + settings.token]);
  return HcConnection.open(link, signal === undefined ? {} : { signal });
}

async function openRelaySession(settings: ConnectionSettings): Promise<SecureLink> {
  const [staticKey, link] = await Promise.all([
    loadDeviceKey(),
    connectRelayClient({ relayUrl: settings.relayUrl, hostId: settings.hostId }),
  ]);
  try {
    return await secureLink(link, {
      role: "initiator",
      hostId: settings.hostId,
      staticKey,
      remoteStatic: base64urlDecode(settings.hostKey),
    });
  } catch (error) {
    if (error instanceof SecureLinkError && error.code === CloseCode.UnknownDevice) throw new DeviceNotPairedError();
    throw error;
  }
}
