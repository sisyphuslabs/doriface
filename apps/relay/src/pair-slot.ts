import { DurableObject } from "cloudflare:workers";
import { budgetResetAt, spendAttempt } from "./pair-budget.ts";
import { claimSlot, liveRecord, type SlotRecord, type StoredSlot } from "./slot-record.ts";

const SLOT = "slot";
const LOOKUPS = "lookups";
const OPENS = "opens";

export type SlotLookup =
  | { readonly status: "found"; readonly record: SlotRecord }
  | { readonly status: "none" }
  | { readonly status: "limited" };

export type PairingOpen = "admitted" | "not-held" | "limited";

/**
 * One object per pairing slot (`idFromName(slot)`): which host holds it, and the slot's budget of 10 lookups and 10
 * pairing-session OPENs per 10 minutes. An alarm clears it once nothing in it counts any more.
 */
export class PairSlot extends DurableObject {
  /** True when the slot is now this host's; false when another host holds it. */
  async claim(record: SlotRecord): Promise<boolean> {
    const next = claimSlot(await this.#slot(), record, Date.now());
    if (next === undefined) return false;
    await this.ctx.storage.put(SLOT, next);
    await this.#scheduleCleanup();
    return true;
  }

  async release(hostId: string): Promise<void> {
    if (liveRecord(await this.#slot(), Date.now())?.hostId === hostId) await this.ctx.storage.delete(SLOT);
  }

  async lookup(): Promise<SlotLookup> {
    const now = Date.now();
    if (!(await this.#spend(LOOKUPS, now))) return { status: "limited" };
    const record = liveRecord(await this.#slot(), now);
    return record === undefined ? { status: "none" } : { status: "found", record };
  }

  /** Admits one pairing session to `hostId`, which must hold the slot. */
  async admitOpen(hostId: string): Promise<PairingOpen> {
    const now = Date.now();
    if (liveRecord(await this.#slot(), now)?.hostId !== hostId) return "not-held";
    return (await this.#spend(OPENS, now)) ? "admitted" : "limited";
  }

  override async alarm(): Promise<void> {
    if ((await this.#cleanupAt()) <= Date.now()) await this.ctx.storage.deleteAll();
    else await this.#scheduleCleanup();
  }

  #slot(): Promise<StoredSlot | undefined> {
    return this.ctx.storage.get<StoredSlot>(SLOT);
  }

  async #spend(key: string, now: number): Promise<boolean> {
    const { allowed, times } = spendAttempt((await this.ctx.storage.get<number[]>(key)) ?? [], now);
    await this.ctx.storage.put(key, times);
    await this.#scheduleCleanup();
    return allowed;
  }

  async #cleanupAt(): Promise<number> {
    const [slot, lookups = [], opens = []] = await Promise.all([
      this.#slot(),
      this.ctx.storage.get<number[]>(LOOKUPS),
      this.ctx.storage.get<number[]>(OPENS),
    ]);
    return Math.max(slot?.expiresAt ?? 0, budgetResetAt(lookups), budgetResetAt(opens));
  }

  async #scheduleCleanup(): Promise<void> {
    await this.ctx.storage.setAlarm(await this.#cleanupAt());
  }
}

export interface PairSlotsEnv {
  readonly PAIR_SLOTS: DurableObjectNamespace<PairSlot>;
}
