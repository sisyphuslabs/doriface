import type { Pattern } from "./noise/handshake.ts";
import { type ByteLink, CloseCode, closeCodeOf, Listeners, SecureLinkError, type Unsubscribe } from "./link.ts";
import type { Transport } from "./transport.ts";

export interface SessionInfo {
  readonly pattern: Pattern;
  readonly remoteStatic: Uint8Array;
  readonly handshakeHash: Uint8Array;
  /** The decrypted message-1 payload (the responder sees the pairing `{"name"}` here). */
  readonly helloPayload: Uint8Array;
}

/** A ByteLink whose bytes travel as Noise transport records over another ByteLink. */
export interface SecureLink extends ByteLink, SessionInfo {}

/**
 * The established session. Data that arrives before the first `onData` listener is held and handed to it, so no
 * byte is lost between the handshake resolving and the caller subscribing.
 */
export class SecuredLink implements SecureLink {
  readonly pattern: Pattern;
  readonly remoteStatic: Uint8Array;
  readonly handshakeHash: Uint8Array;
  readonly helloPayload: Uint8Array;
  readonly #link: ByteLink;
  readonly #transport: Transport;
  readonly #data = new Listeners<Uint8Array>();
  readonly #close = new Listeners<Error | undefined>();
  readonly #held: Uint8Array[] = [];
  #closed = false;
  #closeError: Error | undefined;

  constructor(link: ByteLink, transport: Transport, info: SessionInfo) {
    this.#link = link;
    this.#transport = transport;
    this.pattern = info.pattern;
    this.remoteStatic = info.remoteStatic;
    this.handshakeHash = info.handshakeHash;
    this.helloPayload = info.helloPayload;
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(bytes: Uint8Array): void {
    if (this.#closed) throw new SecureLinkError(undefined, "secure link is closed");
    for (const record of this.#transport.seal(bytes)) this.#link.send(record);
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    const unsubscribe = this.#data.add(listener);
    for (const chunk of this.#held.splice(0)) this.#data.emit(chunk);
    return unsubscribe;
  }

  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    if (!this.#closed) return this.#close.add(listener);
    const error = this.#closeError;
    queueMicrotask(() => listener(error));
    return () => {};
  }

  close(code?: number, reason?: string): void {
    if (this.#closed) return;
    this.#link.close(code, reason);
    this.linkClosed(undefined);
  }

  /** Feeds one record from the underlying link; any failure closes the link with 4400. */
  receive(record: Uint8Array): void {
    if (this.#closed) return;
    let plaintext: Uint8Array;
    try {
      plaintext = this.#transport.open(record);
    } catch (error) {
      this.fail(new SecureLinkError(CloseCode.CryptoFailure, "record failed authentication", { cause: error }));
      return;
    }
    if (plaintext.byteLength === 0) return;
    if (this.#data.size === 0) this.#held.push(plaintext);
    else this.#data.emit(plaintext);
  }

  fail(error: SecureLinkError): void {
    if (this.#closed) return;
    this.#link.close(error.code, error.message);
    this.linkClosed(error);
  }

  linkClosed(error: Error | undefined): void {
    if (this.#closed) return;
    this.#closed = true;
    const code = closeCodeOf(error);
    this.#closeError =
      error === undefined || error instanceof SecureLinkError
        ? error
        : new SecureLinkError(code, error.message, { cause: error });
    this.#held.length = 0;
    this.#close.emit(this.#closeError);
  }
}
