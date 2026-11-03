import { slotOf } from "./code.ts";
import { fromBase64Url, offerFrom, type PairingParse } from "./fragment.ts";

/** The relay's HTTP origin for a ws(s) relay URL. */
export function relayHttpOrigin(relayUrl: string): string {
  return relayUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && Object.hasOwn(body, key) ? Reflect.get(body, key) : undefined;
}

/**
 * Asks the relay which host holds this code's slot. The answer is untrusted: the fingerprint
 * check and the psk handshake authenticate it.
 */
export async function lookupCode(code: string, relayUrl: string, signal?: AbortSignal): Promise<PairingParse> {
  let response: Response;
  try {
    response = await fetch(
      `${relayHttpOrigin(relayUrl)}/v1/pair/${slotOf(code)}`,
      signal === undefined ? {} : { signal },
    );
  } catch {
    return { ok: false, reason: "The relay cannot be reached. Check the network, or scan the QR code instead." };
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
  if (noiseStaticPub === null || signPub === null) return { ok: false, reason: "The relay's answer is malformed." };
  return offerFrom({ hostId, noiseStaticPub, signPub }, code, relayUrl);
}
