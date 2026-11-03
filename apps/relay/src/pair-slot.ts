import { DurableObject } from "cloudflare:workers";
import {
  budgetResetAt,
  PAIR_BUDGET,
  PAIR_BUDGET_WINDOW_MS,
  PER_SOURCE_PAIR_QUOTA,
  spendAttempt,
  withinBudget,
} from "./pair-budget.ts";
import { claimSlot, liveRecord, type SlotRecord, type StoredSlot } from "./slot-record.ts";

const SLOT = "slot";
const LOOKUPS = "lookups";
/** Pairing sessions the host answered, charged against the slot's budget. */
const SESSIONS = "sessions";
const sourceKey = (kind: "lookups" | "opens", source: string): string => `${kind}:${source}`;

export type SlotLookup =
  | { readonly status: "found"; readonly record: SlotRecord }
  | { readonly status: "none" }
  | { readonly status: "limited" };

export type PairingOpen = "admitted" | "not-held" | "limited";

const isTimes = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((time) => typeof time === "number");

/**
 * One object per pairing slot (`idFromName(slot)`): which host holds it, the slot's budget of 10 lookups and 10
 * answered pairing sessions per 10 minutes, and each source's quota of 3 lookups and 3 pairing sessions. An alarm
 * clears it once nothing in it counts any more.
 */
export class PairSlot extends DurableObject {
  /** True when the slot is now this host's; false when another host holds it. */
  async claim(record: SlotRecord): Promise<boolean> {
    const next = claimSlot(await this.#slot(), record, Date.now());
    if (next === undefined) return false;
    await this.ctx.storage.put(SLOT, next);
    await this.#cleanupNoEarlierThan(next.expiresAt);
    return true;
  }

  async release(hostId: string): Promise<void> {
    if (liveRecord(await this.#slot(), Date.now())?.hostId === hostId) await this.ctx.storage.delete(SLOT);
  }

  async lookup(source: string): Promise<SlotLookup> {
    const now = Date.now();
    const charges = [
      { key: LOOKUPS, limit: PAIR_BUDGET },
      { key: sourceKey("lookups", source), limit: PER_SOURCE_PAIR_QUOTA },
    ];
    if (!(await this.#spendAll(charges, now))) return { status: "limited" };
    const record = liveRecord(await this.#slot(), now);
    return record === undefined ? { status: "none" } : { status: "found", record };
  }

  /**
   * Admits a pairing session from `source` to `hostId`, which must hold the slot. It spends the source's quota now;
   * the slot's budget is charged by `chargeSession` once the host answers the session.
   */
  async admitOpen(hostId: string, source: string): Promise<PairingOpen> {
    const now = Date.now();
    if (liveRecord(await this.#slot(), now)?.hostId !== hostId) return "not-held";
    if (!withinBudget(await this.#times(SESSIONS), now, PAIR_BUDGET)) return "limited";
    const charges = [{ key: sourceKey("opens", source), limit: PER_SOURCE_PAIR_QUOTA }];
    return (await this.#spendAll(charges, now)) ? "admitted" : "limited";
  }

  /** Charges an answered pairing session to the slot; false when the slot's budget was already spent. */
  chargeSession(): Promise<boolean> {
    return this.#spendAll([{ key: SESSIONS, limit: PAIR_BUDGET }], Date.now());
  }

  override async alarm(): Promise<void> {
    const cleanupAt = await this.#cleanupAt();
    if (cleanupAt <= Date.now()) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(cleanupAt);
  }

  #slot(): Promise<StoredSlot | undefined> {
    return this.ctx.storage.get<StoredSlot>(SLOT);
  }

  async #times(key: string): Promise<number[]> {
    const value: unknown = await this.ctx.storage.get(key);
    return isTimes(value) ? value : [];
  }

  /** Spends one attempt on every budget in `charges`, or on none of them when any is exhausted. */
  async #spendAll(charges: readonly { readonly key: string; readonly limit: number }[], now: number): Promise<boolean> {
    const current = await Promise.all(charges.map(async ({ key }) => this.#times(key)));
    if (!charges.every(({ limit }, index) => withinBudget(current[index] ?? [], now, limit))) return false;
    const spent = charges.map(({ key, limit }, index) => [key, spendAttempt(current[index] ?? [], now, limit).times]);
    await this.ctx.storage.put(Object.fromEntries(spent));
    await this.#cleanupNoEarlierThan(now + PAIR_BUDGET_WINDOW_MS);
    return true;
  }

  async #cleanupAt(): Promise<number> {
    const stored = await this.ctx.storage.list();
    const slot = await this.#slot();
    const resets = [...stored.values()].map((value) => (isTimes(value) ? budgetResetAt(value) : 0));
    return Math.max(slot?.expiresAt ?? 0, ...resets);
  }

  /** Moves the cleanup alarm later when `at` is later; every other input to it only ever expires earlier. */
  async #cleanupNoEarlierThan(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current < at) await this.ctx.storage.setAlarm(at);
  }
}

export interface PairSlotsEnv {
  readonly PAIR_SLOTS: DurableObjectNamespace<PairSlot>;
}
