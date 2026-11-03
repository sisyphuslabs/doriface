import type { Room, RoomEnv } from "./room.ts";

export interface Env extends RoomEnv {
  readonly ROOM: DurableObjectNamespace<Room>;
  /** WebSocket upgrades per IP. */
  readonly CONNECT_LIMIT: RateLimit;
  /** Pairing slot lookups per IP. */
  readonly PAIR_LIMIT: RateLimit;
}
