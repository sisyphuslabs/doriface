import {
  fromBase64Url,
  HOST_ID_PATTERN,
  hostIdOf,
  NOISE_STATIC_PUB_BYTES,
  normalizePairCode,
  pairSlotOf,
  SIGN_PUB_BYTES,
} from "./wire/index.ts";

/** What the relay says is pairing on a slot. Untrusted: the psk and the fingerprint check authenticate it. */
export interface PairSlotRecord {
  readonly hostId: string;
  readonly noiseStaticPub: Uint8Array;
  readonly signPub: Uint8Array;
}

export class PairLookupError extends Error {
  override readonly name = "PairLookupError";
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PairLookupOptions {
  /** e.g. `https://relay-doriface.omo.dev`. */
  readonly relayUrl: string;
  /** The code as typed, e.g. `ab3k 9xqz`; only its slot is sent. */
  readonly code: string;
  readonly fetch?: (url: string) => Promise<Response>;
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Object.getOwnPropertyDescriptor(body, name)?.value : undefined;
}

async function parseRecord(body: unknown): Promise<PairSlotRecord | undefined> {
  const hostId = field(body, "hostId");
  const noise = field(body, "noiseStaticPub");
  const sign = field(body, "signPub");
  if (typeof hostId !== "string" || typeof noise !== "string" || typeof sign !== "string") return undefined;
  const noiseStaticPub = fromBase64Url(noise);
  const signPub = fromBase64Url(sign);
  if (!HOST_ID_PATTERN.test(hostId) || noiseStaticPub?.byteLength !== NOISE_STATIC_PUB_BYTES) return undefined;
  if (signPub?.byteLength !== SIGN_PUB_BYTES || (await hostIdOf(signPub)) !== hostId) return undefined;
  return { hostId, noiseStaticPub, signPub };
}

/**
 * Finds the host pairing on a typed code's slot. Undefined when no host holds the slot; throws PairLookupError for
 * a malformed code, a rate limit (429) or an answer that does not parse or whose signPub does not hash to hostId.
 */
export async function lookupPairSlot(options: PairLookupOptions): Promise<PairSlotRecord | undefined> {
  const code = normalizePairCode(options.code);
  if (code === undefined) throw new PairLookupError(400, "a pairing code is 8 characters from 0-9 and A-Z");
  const url = new URL(`/v1/pair/${pairSlotOf(code)}`, options.relayUrl).toString();
  const response = await (options.fetch ?? fetch)(url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new PairLookupError(response.status, `pairing lookup failed with HTTP ${response.status}`);
  const record = await parseRecord(await response.json());
  if (record === undefined) throw new PairLookupError(502, "the relay's pairing answer is malformed");
  return record;
}
