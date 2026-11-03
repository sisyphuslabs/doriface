import type { ServerWebSocket } from "bun";
import { ByteQueue, type DataHandler, type Link } from "./link.ts";

/**
 * A server-side WebSocket as a Link. Inbound messages are handed on one at a time and the socket stops reading
 * while a backlog exists; outbound sends wait for Bun's drain once the socket reports backpressure.
 */
export class WsLink<T> implements Link {
  readonly #ws: ServerWebSocket<T>;
  readonly #inbox: ByteQueue;
  readonly #closeHandlers: (() => void)[] = [];
  #drain: PromiseWithResolvers<void> | undefined;
  #closed = false;

  constructor(ws: ServerWebSocket<T>) {
    this.#ws = ws;
    this.#inbox = new ByteQueue({
      onBacklog: () => ws.pause(),
      onDrained: () => {
        if (ws.isPaused) ws.resume();
      },
      onError: () => this.close(1011, "internal error"),
    });
  }

  /** Feeds one message from the Bun websocket `message` callback. */
  receive(message: string | Uint8Array): void {
    if (typeof message === "string") this.close(1003, "binary frames only");
    else this.#inbox.push(message);
  }

  /** Bun's `drain` callback: the socket can take more data. */
  drained(): void {
    const drain = this.#drain;
    this.#drain = undefined;
    drain?.resolve();
  }

  /** Bun's `close` callback: the peer or the server closed the socket. */
  peerClosed(): void {
    this.#finish();
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error("websocket is closed");
    const status = this.#ws.send(bytes);
    if (status === 0) throw new Error("websocket dropped the message");
    if (status === -1) {
      this.#drain ??= Promise.withResolvers();
      await this.#drain.promise;
    }
  }

  onData(handler: DataHandler): void {
    this.#inbox.setHandler(handler);
  }

  onClose(handler: () => void): void {
    if (this.#closed) handler();
    else this.#closeHandlers.push(handler);
  }

  close(code = 1000, reason = ""): void {
    if (this.#closed) return;
    this.#finish();
    this.#ws.close(code, reason);
  }

  #finish(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#inbox.clear();
    this.drained();
    for (const handler of this.#closeHandlers.splice(0)) handler();
  }
}
