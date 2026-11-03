import { MUX_HEADER_BYTES } from "./mux.ts";

/** The relay refuses WebSocket messages over 1 MiB, uplink frames included. */
export const RELAY_MESSAGE_CAP = 1024 * 1024;
/** The largest session payload either way: a host's DATA frame must fit the cap with its mux header. */
export const MAX_SESSION_SEND_BYTES = RELAY_MESSAGE_CAP - MUX_HEADER_BYTES;
