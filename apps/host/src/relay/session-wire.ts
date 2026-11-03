import type { Unsubscribe } from "@doriface/crypto";
import type { SessionLink } from "@doriface/relay-client";
import type { E2eeWire } from "../e2ee/links.ts";

const INTERNAL_ERROR = 1011;

/** One relay session as the record layer's wire; a failed write closes the session instead of going unnoticed. */
export class RelaySessionWire implements E2eeWire {
  readonly #session: SessionLink;
  #pending: Promise<void> = Promise.resolve();
  #gate: () => Promise<void> | undefined = () => undefined;

  constructor(session: SessionLink) {
    this.#session = session;
  }

  send(bytes: Uint8Array): void {
    this.#pending = this.#session.send(bytes);
    this.#pending.catch(() => this.#session.close(INTERNAL_ERROR, "send failed"));
  }

  flushed(): Promise<void> {
    return this.#pending;
  }

  /** The session's next chunk, and its relay ack, wait while `gate` returns a promise. */
  readWhen(gate: () => Promise<void> | undefined): void {
    this.#gate = gate;
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    return this.#session.onData((bytes) => {
      listener(bytes);
      return this.#gate();
    });
  }

  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    return this.#session.onClose(listener);
  }

  close(code?: number, reason?: string): void {
    this.#session.close(code, reason);
  }
}
