import { ed25519 } from "@noble/curves/ed25519.js";
import {
  fromBase64Url,
  HOST_ID_PATTERN,
  hostIdOf,
  isPairSlotExpiry,
  NOISE_STATIC_PUB_BYTES,
  normalizePairCode,
  PAIR_SLOT_SIGNATURE_BYTES,
  pairSlotOf,
  pairSlotStatement,
  SIGN_PUB_BYTES,
} from "./wire/index.ts";

/** What the relay says is pairing on a slot. Untrusted: the psk and the fingerprint check authenticate it. */
export interface PairSlotRecord {
  readonly hostId: string;
  readonly noiseStaticPub: Uint8Array;
  readonly signPub: Uint8Array;
  /** Present when the host registered the signed form (contract v1.9): the offer's expiry, ms since the epoch. */
  readonly expiresAt?: number;
  /** With `expiresAt`: the host's Ed25519 signature over `pairSlotStatement`, as the relay stored it. */
  readonly slotSig?: Uint8Array;
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
  /** The client's clock, for the signed expiry's bounds; Date.now by default. */
  readonly now?: () => number;
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
  const expiresAt = field(body, "expiresAt");
  const sig = field(body, "slotSig");
  if (expiresAt === undefined && sig === undefined) return { hostId, noiseStaticPub, signPub };
  // The signed form's two fields come together; one alone, or either out of shape, is a malformed answer.
  const slotSig = typeof sig === "string" ? fromBase64Url(sig) : undefined;
  if (!isPairSlotExpiry(expiresAt) || slotSig?.byteLength !== PAIR_SLOT_SIGNATURE_BYTES) return undefined;
  return { hostId, noiseStaticPub, signPub, expiresAt, slotSig };
}

/** How long an offer lives (PAIRING_TTL_MS in @doriface/crypto), and the clock difference a client allows either way. */
export const PAIR_OFFER_TTL_MS = 10 * 60 * 1000;
export const PAIR_SLOT_CLOCK_ALLOWANCE_MS = 10 * 60 * 1000;

/** Why a v1.9 client refuses an answer without the host's signature: the host or its relay predates v1.9 (#22). */
export const UNSIGNED_SLOT_REASON =
  "this host did not sign its pairing key: it or its relay is older than v1.9; update doriface-host and its relay, or use its link or QR code";

export type PairSlotVerdict = "signed" | "unsigned" | "bad-signature" | "expired" | "too-far-ahead";

/**
 * Whether the host named by `record` signed its Noise key for `slot` (#22): an Ed25519 signature by `signPub` over
 * `pairSlotStatement(slot, noiseStaticPub, expiresAt)`, with `expiresAt` no more than the allowance in the past and no
 * more than one offer TTL plus the allowance ahead of `now`, by the client's clock.
 */
export function pairSlotVerdict(record: PairSlotRecord, slot: string, now: number): PairSlotVerdict {
  const { expiresAt, slotSig } = record;
  if (expiresAt === undefined || slotSig === undefined) return "unsigned";
  const statement = pairSlotStatement(slot, record.noiseStaticPub, expiresAt);
  let valid = false;
  try {
    valid = ed25519.verify(slotSig, statement, record.signPub);
  } catch {
    valid = false;
  }
  if (!valid) return "bad-signature";
  if (expiresAt < now - PAIR_SLOT_CLOCK_ALLOWANCE_MS) return "expired";
  if (expiresAt > now + PAIR_OFFER_TTL_MS + PAIR_SLOT_CLOCK_ALLOWANCE_MS) return "too-far-ahead";
  return "signed";
}

const VERDICT_REASONS: Readonly<Record<Exclude<PairSlotVerdict, "signed">, string>> = {
  unsigned: UNSIGNED_SLOT_REASON,
  "bad-signature": "the relay's pairing answer is not signed by the host it names; do not pair through this relay",
  expired: "the relay's pairing answer has expired; ask for a new code, or check this computer's clock",
  "too-far-ahead": "the relay's pairing answer expires too far ahead; check this computer's clock and the host's",
};

/** The reason a client shows for a verdict other than "signed". */
export function pairSlotRefusal(verdict: Exclude<PairSlotVerdict, "signed">): string {
  return VERDICT_REASONS[verdict];
}

/**
 * Finds the host pairing on a typed code's slot. Undefined when no host holds the slot; throws PairLookupError for
 * a malformed code, a rate limit (429), an answer that does not parse or whose signPub does not hash to hostId, or (contract v1.9, #22)
 * an answer the named host did not sign for this slot within its lifetime (502, with the reason).
 */
export async function lookupPairSlot(options: PairLookupOptions): Promise<PairSlotRecord | undefined> {
  const now = options.now ?? Date.now;
  const code = normalizePairCode(options.code);
  if (code === undefined) throw new PairLookupError(400, "a pairing code is 8 characters from 0-9 and A-Z");
  const url = new URL(`/v1/pair/${pairSlotOf(code)}`, httpUrl(options.relayUrl)).toString();
  const init = options.signal === undefined ? {} : { signal: options.signal };
  const response = await (options.fetch ?? fetch)(url, init);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new PairLookupError(response.status, `pairing lookup failed with HTTP ${response.status}`);
  const record = await parseRecord(await jsonBody(response));
  if (record === undefined) throw new PairLookupError(502, "the relay's pairing answer is malformed");
  const verdict = pairSlotVerdict(record, pairSlotOf(code), now());
  if (verdict !== "signed") throw new PairLookupError(502, pairSlotRefusal(verdict));
  return record;
}
