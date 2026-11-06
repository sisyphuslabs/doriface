import { RelayCloseError } from "./link.ts";
import type { RelayProofs } from "./pass-book.ts";
import { type CreateSocket, defaultCreateSocket, relaySocketUrl } from "./socket.ts";
import { WebSocketLink } from "./websocket-link.ts";
import {
  CloseCode,
  CREDIT_QUERY,
  HOST_ID_PATTERN,
  PAIR_SLOT_PATTERN,
  PING_INTERVAL_MS,
  PROOF_QUERY,
  relayOriginOf,
} from "./wire/index.ts";

export interface ClientConnectOptions {
  /** e.g. `https://relay-doriface.omo.dev`. */
  readonly relayUrl: string;
  readonly hostId: string;
  /**
   * The pairing slot when this session runs the IKpsk2 pairing handshake. The relay admits at most 10 pairing
   * sessions per slot per 10 minutes, and only to the host that holds the slot.
   */
  readonly pairSlot?: string;
  readonly pingIntervalMs?: number;
  readonly createSocket?: CreateSocket;
  /** How long the socket has to open, so a relay that never answers cannot hold a connect open; default {@link RELAY_CONNECT_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
  /** The caller's own cancellation: the socket is closed and the connect rejects with its reason. */
  readonly signal?: AbortSignal | undefined;
  /** A host's relay passes (contract v1.6): the session carries a proof when one is available. */
  readonly proofs?: Pick<RelayProofs, "proof" | "refused"> | undefined;
}

/** How long a client session's socket has to open, in step with the 10 s the handshakes after it allow. */
export const RELAY_CONNECT_TIMEOUT_MS = 10_000;

function cancelledBy(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("the relay session was cancelled");
}

/**
 * Opens a client session to a host through the relay. Resolves once the socket is open; refusals (4404 host
 * offline, 4429 rate limited) arrive afterwards as the link's close, with the code on the RelayCloseError.
 */
export async function connectRelayClient(options: ClientConnectOptions): Promise<WebSocketLink> {
  const { hostId, pairSlot } = options;
  if (!HOST_ID_PATTERN.test(hostId)) throw new Error(`invalid hostId ${hostId}`);
  if (pairSlot !== undefined && !PAIR_SLOT_PATTERN.test(pairSlot)) throw new Error(`invalid pairing slot ${pairSlot}`);
  const { signal } = options;
  if (signal?.aborted === true) throw cancelledBy(signal);
  const query = new URLSearchParams(pairSlot === undefined ? [] : [["pair", pairSlot]]);
  query.set(...CREDIT_QUERY);
  const relayOrigin = relayOriginOf(relaySocketUrl(options.relayUrl, "/"));
  const proof = options.proofs?.proof("client", hostId, relayOrigin);
  if (proof !== undefined) query.set(PROOF_QUERY, proof);
  const url = relaySocketUrl(options.relayUrl, `/v1/client/${hostId}?${query.toString()}`);
  const ws = (options.createSocket ?? defaultCreateSocket)(url);
  const link = new WebSocketLink(ws, options.pingIntervalMs ?? PING_INTERVAL_MS, { credit: true });
  if (proof !== undefined) {
    link.onClose((error) => {
      if (error instanceof RelayCloseError && error.code === CloseCode.PassRefused)
        options.proofs?.refused(relayOrigin, proof);
    });
  }
  // The URL may carry a proof: errors (and so logs) name the path only.
  const path = relaySocketUrl(options.relayUrl, `/v1/client/${hostId}`);
  const timeoutMs = options.timeoutMs ?? RELAY_CONNECT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    function settle(): boolean {
      if (settled) return false;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      return true;
    }
    function fail(error: Error): void {
      if (!settle()) return;
      if (ws.readyState === WebSocket.CONNECTING) ws.close();
      link.close();
      reject(error);
    }
    function onAbort(): void {
      if (signal !== undefined) fail(cancelledBy(signal));
    }
    timer = setTimeout(() => fail(new Error(`relay socket to ${path} did not open within ${timeoutMs} ms`)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    ws.addEventListener(
      "open",
      () => {
        if (settle()) resolve(link);
      },
      { once: true },
    );
    link.onClose((error) => {
      if (!settle()) return;
      reject(error ?? new Error(`relay socket to ${path} closed before opening`));
    });
  });
}
