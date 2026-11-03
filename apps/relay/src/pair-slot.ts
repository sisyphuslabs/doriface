import { DurableObject } from "cloudflare:workers";
import { claimSlot, liveRecord, type SlotRecord, type StoredSlot } from "./slot-record.ts";

const KEY = "slot";

/** One object per pairing slot (`idFromName(slot)`): which host holds it, until the TTL alarm clears it. */
export class PairSlot extends DurableObject {
  /** True when the slot is now this host's; false when another host holds it. */
  async claim(record: SlotRecord): Promise<boolean> {
    const next = claimSlot(await this.ctx.storage.get<StoredSlot>(KEY), record, Date.now());
    if (next === undefined) return false;
    await this.ctx.storage.put(KEY, next);
    await this.ctx.storage.setAlarm(next.expiresAt);
    return true;
  }

  async lookup(): Promise<SlotRecord | null> {
    return liveRecord(await this.ctx.storage.get<StoredSlot>(KEY), Date.now()) ?? null;
  }

  override async alarm(): Promise<void> {
    if (liveRecord(await this.ctx.storage.get<StoredSlot>(KEY), Date.now()) === undefined) {
      await this.ctx.storage.deleteAll();
    }
  }
}

export interface PairSlotsEnv {
  readonly PAIR_SLOTS: DurableObjectNamespace<PairSlot>;
}
