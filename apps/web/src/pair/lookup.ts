import { isPairSlotExpiry, PAIR_SLOT_SIGNATURE_BYTES } from "@doriface/relay-client/wire";
import { pairSlotRefusal, pairSlotVerdict } from "@doriface/relay-client";
import { slotOf } from "./code.ts";
import { fromBase64Url, offerFrom, type PairingParse } from "./fragment.ts";

/** The relay's HTTP origin for a ws(s) relay URL. */
export function relayHttpOrigin(relayUrl: string): string {
  return relayUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && Object.hasOwn(body, key) ? Reflect.get(body, key) : undefined;
}

/** A client-facing sentence from one of relay-client's lower-case reasons. */
const sentence = (reason: string): string => `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;

const MALFORMED = "The relay's answer is malformed.";

/**
 * Asks the relay which host holds this code's slot. The answer is untrusted: the host's signature over its slot and
 * Noise key (contract v1.9, #22), then the fingerprint check and the CPace pairing handshake authenticate it.
 */
export async function lookupCode(code: string, relayUrl: string, signal?: AbortSignal): Promise<PairingParse> {
  let response: Response;
  try {
    response = await fetch(
      `${relayHttpOrigin(relayUrl)}/v1/pair/${slotOf(code)}`,
      signal === undefined ? {} : { signal },
    );
  } catch {
    return { ok: false, reason: "The relay cannot be reached. Check the network and try again." };
  }
  if (response.status === 404) return { ok: false, reason: "No host is pairing with this code. It may have expired." };
  if (!response.ok) return { ok: false, reason: `The relay answered ${response.status}. Try a new code.` };
  const body: unknown = await response.json().catch(() => null);
  const hostId = field(body, "hostId");
  const noise = field(body, "noiseStaticPub");
  const sign = field(body, "signPub");
  if (typeof hostId !== "string" || typeof noise !== "string" || typeof sign !== "string") {
    return { ok: false, reason: "The relay's answer is malformed." };
  }
  const noiseStaticPub = fromBase64Url(noise);
  const signPub = fromBase64Url(sign);
  if (noiseStaticPub === null || signPub === null) return { ok: false, reason: MALFORMED };
  const expiresAt = field(body, "expiresAt");
  const sig = field(body, "slotSig");
  const slotSig = typeof sig === "string" ? fromBase64Url(sig) : null;
  // The signed form's two fields come together; one alone, or either out of shape, is a malformed answer.
  const signed = expiresAt !== undefined || sig !== undefined;
  if (signed && (!isPairSlotExpiry(expiresAt) || slotSig?.byteLength !== PAIR_SLOT_SIGNATURE_BYTES)) {
    return { ok: false, reason: MALFORMED };
  }
  const record =
    signed && slotSig !== null && isPairSlotExpiry(expiresAt)
      ? { hostId, noiseStaticPub, signPub, expiresAt, slotSig }
      : { hostId, noiseStaticPub, signPub };
  const verdict = pairSlotVerdict(record, slotOf(code), Date.now());
  if (verdict !== "signed") return { ok: false, reason: sentence(pairSlotRefusal(verdict)) };
  return offerFrom({ hostId, noiseStaticPub, signPub }, { mode: "code", code }, relayUrl);
}
