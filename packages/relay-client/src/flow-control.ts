import { isOpen } from "./socket.ts";
import { ACK_INTERVAL_BYTES, encodeAck, PING } from "./wire/index.ts";

/** Counts binary bytes received on one relay socket and acks the running total every 64 KiB (contract v1.2 C3). */
export class AckCounter {
  #received = 0;
  #acked = 0;

  ackFor(receivedBytes: number): string | undefined {
    this.#received += receivedBytes;
    if (this.#received - this.#acked < ACK_INTERVAL_BYTES) return undefined;
    this.#acked = this.#received;
    return encodeAck(this.#received);
  }
}

/** Sends `ping` every `intervalMs` while the socket is open (contract v1.2 C6). */
export function keepAlive(ws: WebSocket, intervalMs: number): () => void {
  const timer = setInterval(() => {
    if (isOpen(ws)) ws.send(PING);
  }, intervalMs);
  const stop = (): void => clearInterval(timer);
  ws.addEventListener("close", stop, { once: true });
  return stop;
}
