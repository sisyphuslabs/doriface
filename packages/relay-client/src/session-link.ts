import { CloseSignal, Inbox } from "./inbox.ts";
import {
  type ByteLink,
  type CloseListener,
  type DataListener,
  LinkClosedError,
  RelayCloseError,
  type Unsubscribe,
} from "./link.ts";
import { MAX_SESSION_SEND_BYTES } from "./limits.ts";
import { CloseCode, encodeClose, encodeData, MUX_HEADER_BYTES } from "./wire/index.ts";

/** What a session needs from the uplink socket it is multiplexed over. */
export interface SessionTransport {
  sendFrame(frame: Uint8Array<ArrayBuffer>): void;
  release(sessionId: number): void;
  /** A DATA frame of this many bytes was consumed or dropped, so the uplink may ack it. */
  consumed(frameBytes: number): void;
}

/** One client session as the host sees it: DATA frames on the uplink, demultiplexed by sessionId. */
export class SessionLink implements ByteLink {
  readonly sessionId: number;
  readonly #transport: SessionTransport;
  readonly #inbox: Inbox;
  readonly #closed = new CloseSignal();

  constructor(sessionId: number, transport: SessionTransport) {
    this.sessionId = sessionId;
    this.#transport = transport;
    this.#inbox = new Inbox(
      (error) => this.#end(error instanceof Error ? error : new Error(String(error)), true),
      (chunk) => transport.consumed(MUX_HEADER_BYTES + chunk.byteLength),
    );
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.#closed.fired) throw new LinkClosedError(`session ${this.sessionId} is closed`);
    if (bytes.byteLength > MAX_SESSION_SEND_BYTES) {
      throw new RangeError(`${bytes.byteLength} bytes exceed the relay's ${MAX_SESSION_SEND_BYTES}-byte message cap`);
    }
    this.#transport.sendFrame(encodeData(this.sessionId, bytes));
  }

  onData(listener: DataListener): Unsubscribe {
    return this.#inbox.add(listener);
  }

  onClose(listener: CloseListener): Unsubscribe {
    return this.#closed.add(listener);
  }

  /** Ends the session and tells the client, through the relay, with a normal close. */
  close(): void {
    this.#end(undefined, true);
  }

  /** Called by the uplink with each DATA payload for this session. */
  deliver(payload: Uint8Array): void {
    if (this.#closed.fired) this.#transport.consumed(MUX_HEADER_BYTES + payload.byteLength);
    else this.#inbox.push(payload);
  }

  /** The client left (CLOSE from the relay) or the uplink dropped; nothing is sent back. */
  ended(code: number): void {
    this.#end(code === CloseCode.Normal ? undefined : new RelayCloseError(code, "session ended"), false);
  }

  #end(error: Error | undefined, tellRelay: boolean): void {
    if (this.#closed.fired) return;
    if (tellRelay) {
      const code = error === undefined ? CloseCode.Normal : CloseCode.InternalError;
      this.#transport.sendFrame(encodeClose(this.sessionId, code));
    }
    this.#transport.release(this.sessionId);
    this.#inbox.clear();
    this.#closed.fire(error);
  }
}
