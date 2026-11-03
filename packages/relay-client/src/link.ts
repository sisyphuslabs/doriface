import type { ByteLink, Unsubscribe } from "@doriface/client";

export { LinkClosedError } from "@doriface/client";
export type { ByteLink, Unsubscribe };

/**
 * A data listener on a relay link. Relay links implement `@doriface/client`'s ByteLink and also accept a listener
 * that returns a promise: the next chunk waits for it, which is how backpressure reaches the sender when a listener
 * forwards into a slower link. Over the relay, one `send` is one WebSocket message and one chunk on the far side,
 * so message boundaries survive for the record layer.
 */
export type DataListener = (bytes: Uint8Array) => void | Promise<void>;
/** `error` is set when the link failed rather than ended normally. */
export type CloseListener = (error: Error | undefined) => void;

/** The relay or the peer closed the socket with a code other than a normal close. */
export class RelayCloseError extends Error {
  override readonly name = "RelayCloseError";
  readonly code: number;

  constructor(code: number, reason: string, options?: ErrorOptions) {
    super(`relay socket closed with ${code}${reason === "" ? "" : `: ${reason}`}`, options);
    this.code = code;
  }
}
