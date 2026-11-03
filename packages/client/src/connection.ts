import type { Frame, HelloResult, JsonRpcNotification } from "@doriface/protocol";
import { raceDeadline } from "./deadline.ts";
import { HcHandshakeError } from "./errors.ts";
import type { ByteLink } from "./link.ts";
import type { Unsubscribe } from "./listeners.ts";
import { Wire } from "./wire.ts";

export interface HcConnectionOptions {
  /** Default 10 000 ms. */
  readonly handshakeTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Frame-level access for passthrough tooling: every incoming frame, and sending any frame. */
export interface RawFrames {
  onFrame(listener: (frame: Frame) => void): Unsubscribe;
  send(channel: number, kind: number, payload?: Uint8Array): void;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

/** One framed herdr-core connection over a ByteLink. */
export class HcConnection {
  readonly hello: HelloResult;
  readonly features: ReadonlySet<string>;
  readonly raw: RawFrames;
  readonly #wire: Wire;

  private constructor(wire: Wire, hello: HelloResult) {
    this.#wire = wire;
    this.hello = hello;
    this.features = new Set(hello.features);
    this.raw = {
      onFrame: (listener) => wire.incoming.add(listener),
      send: (channel, kind, payload) => wire.send(channel, kind, payload),
    };
  }

  /** Sends the framed `hello` and resolves once the core switched to frames. Closes the link on failure. */
  static async open(link: ByteLink, options: HcConnectionOptions = {}): Promise<HcConnection> {
    const wire = new Wire(link);
    const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    try {
      const hello = await raceDeadline(
        wire.hello,
        { timeoutMs, signal: options.signal },
        () => new HcHandshakeError(`no hello reply within ${timeoutMs} ms`),
      );
      return new HcConnection(wire, hello);
    } catch (error) {
      wire.close(error instanceof Error ? error : undefined);
      throw error;
    }
  }

  get closed(): boolean {
    return this.#wire.isClosed;
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): Unsubscribe {
    return this.#wire.notifications.add(listener);
  }

  /** `error` is undefined after `close()`, and set when the link or the protocol failed. */
  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    if (this.#wire.isClosed) {
      const error = this.#wire.closeError;
      queueMicrotask(() => listener(error));
      return () => {};
    }
    return this.#wire.closed.add(listener);
  }

  close(): void {
    this.#wire.close();
  }
}
