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

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

export interface PairLookupOptions {
  /** e.g. `https://relay-doriface.omo.dev`. */
  readonly relayUrl: string;
  /** The code as typed, e.g. `ab3k 9xqz`; only its slot is sent. */
  readonly code: string;
  /** Cancels the lookup, e.g. when the person leaves the pairing screen. */
  readonly signal?: AbortSignal;
  readonly fetch?: (url: string, init?: { readonly signal?: AbortSignal }) => Promise<Response>;
}

/** The relay is often configured by its WebSocket URL; the lookup is plain HTTP(S) on the same host. */
function httpUrl(relayUrl: string): string {
  return relayUrl.replace(/^ws(s?):\/\//i, "http$1://");
}

async function jsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new PairLookupError(502, "the relay's pairing answer is not JSON", { cause: error });
  }
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
  const url = new URL(`/v1/pair/${pairSlotOf(code)}`, httpUrl(options.relayUrl)).toString();
  const init = options.signal === undefined ? {} : { signal: options.signal };
  const response = await (options.fetch ?? fetch)(url, init);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new PairLookupError(response.status, `pairing lookup failed with HTTP ${response.status}`);
  const record = await parseRecord(await jsonBody(response));
  if (record === undefined) throw new PairLookupError(502, "the relay's pairing answer is malformed");
  return record;
}
