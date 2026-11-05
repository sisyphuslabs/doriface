import { MUX_HEADER_BYTES } from "./mux.ts";

/** The relay refuses WebSocket messages over 1 MiB, uplink frames included. */
export const RELAY_MESSAGE_CAP = 1024 * 1024;
/** The largest session payload either way: a host's DATA frame must fit the cap with its mux header. */
export const MAX_SESSION_SEND_BYTES = RELAY_MESSAGE_CAP - MUX_HEADER_BYTES;
/** Contract "Session admission": sessions the host has sent DATA on, at most, per host. */
export const MAX_ACTIVE_SESSIONS = 32;
/** Contract "Session admission": sessions still waiting for the host's first DATA, at most, per host. */
export const MAX_PENDING_SESSIONS = 8;
