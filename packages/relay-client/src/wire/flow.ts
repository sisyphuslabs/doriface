/**
 * Relay flow control (contract v1.2 C3) and keepalive (C6). `ping`, `pong` and `a:<n>` acks are the only text
 * messages on relay sockets; everything else is binary.
 */
export const ACK_INTERVAL_BYTES = 64 * 1024;
export const MAX_UNACKED_BYTES = 4 * 1024 * 1024;
export const PING = "ping";
export const PONG = "pong";
export const PING_INTERVAL_MS = 30_000;
/** The relay reaps a socket whose last pong (or, before any, its connect) is older than this. */
export const IDLE_TIMEOUT_MS = 90_000;

/** The ack a receiver sends: the total bytes it has received on this socket so far. */
export function encodeAck(totalReceived: number): string {
  return `a:${totalReceived}`;
}

export function parseAck(text: string): number | undefined {
  const digits = /^a:(0|[1-9][0-9]{0,15})$/.exec(text)?.[1];
  if (digits === undefined) return undefined;
  const total = Number(digits);
  return Number.isSafeInteger(total) ? total : undefined;
}
