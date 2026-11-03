import { MUX_HEADER_BYTES } from "./wire/index.ts";

/** The relay refuses WebSocket messages over 1 MiB. */
export const RELAY_MESSAGE_CAP = 1024 * 1024;
/** A host's DATA frame must fit the cap with its mux header. */
export const MAX_SESSION_SEND_BYTES = RELAY_MESSAGE_CAP - MUX_HEADER_BYTES;
