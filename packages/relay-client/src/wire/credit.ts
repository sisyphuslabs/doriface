/**
 * End-to-end session credit (contract v1.3). The relay's 4 MiB cap is per socket, so a sender cannot see how far
 * behind the peer on the other socket is. With credit, each side reports the session bytes it consumed: the host as
 * a CREDIT mux frame (which the relay passes to the client as `c:<n>`), the client through its `a:<n>` acks (which
 * the relay passes to the host as CREDIT). A sender then keeps at most {@link SESSION_WINDOW_BYTES} in flight.
 * Peers opt in by dialing with `?credit=1`; a relay that serves credit says so with `c:0` / a zero CREDIT.
 */
export const SESSION_WINDOW_BYTES = 512 * 1024;
export const CREDIT_QUERY = ["credit", "1"] as const;

/** Relay to client: the host consumed `bytes` more of this session. */
export function encodeCreditText(bytes: number): string {
  return `c:${bytes}`;
}

export function parseCreditText(text: string): number | undefined {
  const digits = /^c:(0|[1-9][0-9]{0,9})$/.exec(text)?.[1];
  if (digits === undefined) return undefined;
  const bytes = Number(digits);
  return bytes <= 0xffff_ffff ? bytes : undefined;
}
