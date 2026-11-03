import { type ByteLink, Listeners, type Unsubscribe } from "../link.ts";

/** A close error that carries the WebSocket close code, as a socket-backed link would report it. */
export class CodedCloseError extends Error {
  readonly code: number;

  constructor(code: number, reason: string) {
    super(reason === "" ? `closed with ${code}` : reason);
    this.code = code;
  }
}

/** One end of an in-memory link. `sent` records every message; `tap` may rewrite or multiply one in flight. */
export class MemoryEnd implements ByteLink {
  readonly sent: Uint8Array[] = [];
  closeCode: number | undefined;
  peer: MemoryEnd | undefined;
  tap: ((bytes: Uint8Array) => readonly Uint8Array[]) | undefined;
  /** Deliver and report closes inside the call instead of on a later microtask. */
  synchronous = false;
  readonly #data = new Listeners<Uint8Array>();
  readonly #close = new Listeners<Error | undefined>();
  #closed = false;

  send(bytes: Uint8Array): void {
    const peer = this.peer;
    if (this.#closed || peer === undefined) throw new Error("memory link is closed");
    const copy = bytes.slice();
    this.sent.push(copy);
    for (const message of this.tap?.(copy) ?? [copy]) {
      if (this.synchronous) peer.deliver(message);
      else queueMicrotask(() => peer.deliver(message));
    }
  }

  deliver(bytes: Uint8Array): void {
    if (!this.#closed) this.#data.emit(bytes);
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    return this.#data.add(listener);
  }

  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    return this.#close.add(listener);
  }

  close(code?: number, reason = ""): void {
    if (this.#closed) return;
    this.closeCode = code;
    this.end(undefined);
    this.peer?.end(code === undefined ? undefined : new CodedCloseError(code, reason));
  }

  end(error: Error | undefined): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.synchronous) this.#close.emit(error);
    else queueMicrotask(() => this.#close.emit(error));
  }
}

export function memoryLinkPair(synchronous = false): readonly [MemoryEnd, MemoryEnd] {
  const a = new MemoryEnd();
  const b = new MemoryEnd();
  a.synchronous = synchronous;
  b.synchronous = synchronous;
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** Resolves with the next close error a link reports, or rejects after `ms`. */
export function nextClose(link: ByteLink, ms = 2000): Promise<Error | undefined> {
  const { promise, resolve, reject } = Promise.withResolvers<Error | undefined>();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  unsubscribe = link.onClose((error) => {
    closed = true;
    clearTimeout(timer);
    unsubscribe?.();
    resolve(error);
  });
  if (closed) {
    unsubscribe();
    return promise;
  }
  timer = setTimeout(() => {
    unsubscribe?.();
    reject(new Error(`no close within ${ms} ms`));
  }, ms);
  return promise;
}
