import type { Room } from "./room.ts";

export interface Env {
  readonly ROOM: DurableObjectNamespace<Room>;
  /** WebSocket upgrades per IP. */
  readonly CONNECT_LIMIT: RateLimit;
}
