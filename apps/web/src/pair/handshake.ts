import { HcConnection } from "@doriface/client";
import { closeCodeOf, type PairingSecret, secureLink } from "@doriface/crypto";
import { CloseCode, connectRelayClient } from "@doriface/relay-client";
import { BROWSER_DEPS, deviceKeyFor, type RelayDeps } from "../connection/relay-deps.ts";
import { slotOf } from "./code.ts";
import type { OfferSecret, PairingOffer } from "./fragment.ts";

const AGAIN = "Run doriface-host pair again.";

const REASONS: Readonly<Record<OfferSecret["mode"], Readonly<Record<number, string>>>> = {
  code: {
    [CloseCode.CryptoFailure]: "The code doesn't match this host. Check it and try again.",
    [CloseCode.UnknownDevice]: `The host refused this code: it was used already or replaced. ${AGAIN}`,
    [CloseCode.HostOffline]: "The host is not connected to the relay. Start doriface-host and try again.",
    [CloseCode.PairSlotUnknown]: "No host is pairing with this code. It may have expired.",
    [CloseCode.RateLimited]: `Too many attempts for this code. Use the QR code or ${AGAIN.toLowerCase()}`,
  },
  link: {
    [CloseCode.CryptoFailure]: `This pairing link doesn't match this host. ${AGAIN}`,
    [CloseCode.UnknownDevice]: `The host refused this link: it was used already or replaced. ${AGAIN}`,
    [CloseCode.HostOffline]: "The host is not connected to the relay. Start doriface-host and try again.",
    [CloseCode.RateLimited]: "Too many attempts from this network. Wait a few minutes and try again.",
  },
};

const UNREACHABLE = "The relay cannot be reached. Check the network and try again.";

export class PairingFailedError extends Error {
  override readonly name = "PairingFailedError";
}

export function pairingFailureReason(mode: OfferSecret["mode"], closeCode: number | undefined): string | undefined {
  return closeCode === undefined ? undefined : REASONS[mode][closeCode];
}

function pairingOption(secret: OfferSecret, name: string): PairingSecret {
  return secret.mode === "code"
    ? { mode: "code", code: secret.code, name }
    : { mode: "link", linkSecret: secret.linkSecret, name };
}

/**
 * Runs the pairing session through the relay: a typed code on a `?pair=<slot>` session, a link on an ordinary one.
 * It resolves only after the host answered `hello` on that session, which the host does only once it stored this
 * device, so the next IK session is admitted.
 */
export async function pairWithHost(offer: PairingOffer, name: string, deps: RelayDeps = BROWSER_DEPS): Promise<void> {
  const { secret } = offer;
  const pairing = pairingOption(secret, name);
  const link = await connectRelayClient({
    relayUrl: offer.relayUrl,
    hostId: offer.hostId,
    ...(secret.mode === "code" ? { pairSlot: slotOf(secret.code) } : {}),
  }).catch((error: unknown) => {
    const reason = pairingFailureReason(secret.mode, error instanceof Error ? closeCodeOf(error) : undefined);
    throw new PairingFailedError(reason ?? UNREACHABLE, { cause: error });
  });
  const staticKey = await deviceKeyFor(link, deps);
  try {
    const secure = await secureLink(link, {
      role: "initiator",
      hostId: offer.hostId,
      staticKey,
      remoteStatic: offer.noiseStaticPub,
      pairing,
    });
    const connection = await HcConnection.open(secure);
    connection.close();
  } catch (error) {
    const reason = pairingFailureReason(secret.mode, error instanceof Error ? closeCodeOf(error) : undefined);
    throw reason === undefined ? error : new PairingFailedError(reason, { cause: error });
  }
}
