import type { ByteLink, SecureLink, Unsubscribe } from "@doriface/crypto";
import { ByteQueue, type DataHandler, type Link } from "../link.ts";
import type { WsLink } from "../ws-link.ts";

/**
 * A server WebSocket as the crypto layer's ByteLink. `send` is fire-and-forget there, so the latest socket write
 * stays reachable through `flushed`, which is how the host keeps waiting for Bun's drain before reading more.
 */
export class WsByteLink<T> implements ByteLink {
  readonly #ws: WsLink<T>;
  #pending: Promise<void> = Promise.resolve();

  constructor(ws: WsLink<T>) {
    this.#ws = ws;
  }

  send(bytes: Uint8Array): void {
    this.#pending = this.#ws.send(bytes);
    this.#pending.catch(() => this.#ws.close(1011, "send failed"));
  }

  flushed(): Promise<void> {
    return this.#pending;
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    this.#ws.onData(listener);
    return () => this.#ws.onData(() => {});
  }

  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    let active = true;
    this.#ws.onClose(() => {
      if (active) listener(undefined);
    });
    return () => {
      active = false;
    };
  }

  close(code?: number, reason?: string): void {
    this.#ws.close(code, reason);
  }
}

/** The decrypted session as the host's Link, so `bridge` pipes it to `hc connect` exactly like `/v1/hc`. */
export function plaintextLink(secure: SecureLink, flushed: () => Promise<void>): Link {
  const inbox = new ByteQueue({ onError: () => secure.close(1011, "internal error") });
  secure.onData((bytes) => inbox.push(bytes));
  return {
    async send(bytes) {
      secure.send(bytes);
      await flushed();
    },
    onData(handler: DataHandler) {
      inbox.setHandler(handler);
    },
    onClose(handler) {
      secure.onClose(() => handler());
    },
    close() {
      inbox.clear();
      secure.close();
    },
  };
}
