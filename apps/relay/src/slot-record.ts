/** Pairing slot bookkeeping, kept free of Workers APIs so the rules are testable on their own. */

export const PAIR_SLOT_TTL_MS = 10 * 60 * 1000;

/** What `GET /v1/pair/<slot>` answers; keys are unpadded base64url. Untrusted by the client until the psk holds. */
export interface SlotRecord {
  readonly hostId: string;
  readonly noiseStaticPub: string;
  readonly signPub: string;
}

export interface StoredSlot {
  readonly record: SlotRecord;
  readonly expiresAt: number;
}

export function liveRecord(stored: StoredSlot | undefined, now: number): SlotRecord | undefined {
  return stored !== undefined && stored.expiresAt > now ? stored.record : undefined;
}

/**
 * The slot after `record` asks for it, or undefined when another host holds it (a 409). The same host may
 * re-register, which refreshes the TTL and the keys.
 */
export function claimSlot(stored: StoredSlot | undefined, record: SlotRecord, now: number): StoredSlot | undefined {
  const holder = liveRecord(stored, now);
  if (holder !== undefined && holder.hostId !== record.hostId) return undefined;
  return { record, expiresAt: now + PAIR_SLOT_TTL_MS };
}
