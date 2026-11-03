import type { ByteLink, SecureLink, Unsubscribe } from "@doriface/crypto";
import { ByteQueue, type DataHandler, type Link } from "../link.ts";
import type { WsLink } from "../ws-link.ts";

/** A transport a session's record layer runs on, with the backpressure `plaintextLink` needs: a socket or a relay session. */
export interface E2eeWire extends ByteLink, Wire {}

/**
 * A server WebSocket as the crypto layer's ByteLink. `send` is fire-and-forget there, so the socket writes stay
 * reachable through `flushed`, which settles once every write so far has; that is how the host waits for Bun's drain
 * before reading more.
 */
export class WsByteLink<T> implements E2eeWire {
  readonly #ws: WsLink<T>;
  #pending: Promise<void> = Promise.resolve();
  #gate: () => Promise<void> | undefined = () => undefined;

  constructor(ws: WsLink<T>) {
    this.#ws = ws;
  }

  send(bytes: Uint8Array): void {
    const sent = this.#ws.send(bytes);
    sent.catch(() => this.#ws.close(1011, "send failed"));
    this.#pending = Promise.all([this.#pending, sent]).then(() => undefined);
    this.#pending.catch(() => undefined);
  }

  flushed(): Promise<void> {
    return this.#pending;
  }

  /** While `gate` returns a promise, the socket reads no further message (and pauses once more arrive). */
  readWhen(gate: () => Promise<void> | undefined): void {
    this.#gate = gate;
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    let active = true;
    this.#ws.onData((bytes) => {
      if (active) listener(bytes);
      return this.#gate();
    });
    return () => {
      active = false;
    };
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

/** The socket side `plaintextLink` needs: its write backpressure and a way to hold its reads. */
export interface Wire {
  flushed(): Promise<void>;
  readWhen(gate: () => Promise<void> | undefined): void;
}

/**
 * The decrypted session as the host's Link, so `bridge` pipes it to `hc connect` exactly like `/v1/hc`. While
 * `hc connect` is still taking an earlier chunk, the socket stops reading, so decrypted data cannot pile up.
 */
export function plaintextLink(secure: SecureLink, wire: Wire): Link {
  let backlog: PromiseWithResolvers<void> | undefined;
  const release = (): void => {
    backlog?.resolve();
    backlog = undefined;
  };
  const inbox = new ByteQueue({
    onBacklog: () => {
      backlog ??= Promise.withResolvers();
    },
    onDrained: release,
    onError: () => secure.close(1011, "internal error"),
  });
  wire.readWhen(() => backlog?.promise);
  secure.onData((bytes) => inbox.push(bytes));
  return {
    async send(bytes) {
      secure.send(bytes);
      await wire.flushed();
    },
    onData(handler: DataHandler) {
      inbox.setHandler(handler);
    },
    onClose(handler) {
      secure.onClose(() => handler());
    },
    close() {
      inbox.clear();
      release();
      secure.close();
    },
  };
}
