import type { PairSlotsEnv } from "./pair-slot.ts";
import type { Room } from "./room.ts";

export interface Env extends PairSlotsEnv {
  readonly ROOM: DurableObjectNamespace<Room>;
  /** WebSocket upgrades per IP. */
  readonly CONNECT_LIMIT: RateLimit;
  /** Pairing slot lookups per IP. */
  readonly PAIR_LIMIT: RateLimit;
}
