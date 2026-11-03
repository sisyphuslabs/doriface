/**
 * A bidirectional byte pipe. Same four members as the client's ByteLink, so an E2EE layer can wrap either end.
 */
export interface Link {
  /** Resolves once the transport has taken the bytes; awaiting it is how backpressure reaches the sender. */
  send(bytes: Uint8Array): Promise<void>;
  /** Sets the one data handler. The next chunk is delivered only after the handler's promise settles. */
  onData(handler: DataHandler): void;
  /** Runs once, when the link closes for any reason. */
  onClose(handler: () => void): void;
  close(): void;
}

export type DataHandler = (bytes: Uint8Array) => void | Promise<void>;

export interface ByteQueueHooks {
  /** A chunk arrived while an earlier one was still being handled. */
  readonly onBacklog?: () => void;
  /** Every queued chunk has been handled. */
  readonly onDrained?: () => void;
  readonly onError: (error: unknown) => void;
}

/** Delivers pushed chunks to one handler strictly in order, one at a time. */
export class ByteQueue {
  readonly #chunks: Uint8Array[] = [];
  readonly #hooks: ByteQueueHooks;
  #handler: DataHandler | undefined;
  #pumping = false;

  constructor(hooks: ByteQueueHooks) {
    this.#hooks = hooks;
  }

  setHandler(handler: DataHandler): void {
    this.#handler = handler;
    this.#pump();
  }

  push(chunk: Uint8Array): void {
    this.#chunks.push(chunk);
    if (this.#pumping) this.#hooks.onBacklog?.();
    this.#pump();
  }

  clear(): void {
    this.#chunks.length = 0;
    this.#handler = undefined;
  }

  #pump(): void {
    if (this.#pumping || this.#handler === undefined || this.#chunks.length === 0) return;
    this.#pumping = true;
    this.#deliver().catch(this.#hooks.onError);
  }

  async #deliver(): Promise<void> {
    const handler = this.#handler;
    const chunk = handler === undefined ? undefined : this.#chunks.shift();
    if (handler === undefined || chunk === undefined) {
      this.#pumping = false;
      this.#hooks.onDrained?.();
      return;
    }
    try {
      await handler(chunk);
    } catch (error) {
      this.#pumping = false;
      throw error;
    }
    return this.#deliver();
  }
}
