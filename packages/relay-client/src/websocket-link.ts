import { CloseSignal, Inbox } from "./inbox.ts";
import {
  type ByteLink,
  type CloseListener,
  type DataListener,
  LinkClosedError,
  RelayCloseError,
  type Unsubscribe,
} from "./link.ts";
import { RELAY_MESSAGE_CAP } from "./limits.ts";
import { isOpen } from "./socket.ts";
import { CloseCode } from "./wire/index.ts";

/** A binary WebSocket as a ByteLink: one message in, one chunk out. A non-normal close carries a RelayCloseError. */
export class WebSocketLink implements ByteLink {
  readonly #ws: WebSocket;
  readonly #inbox: Inbox;
  readonly #closed = new CloseSignal();
  #closeCode: number | undefined;

  constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.binaryType = "arraybuffer";
    this.#inbox = new Inbox(() => this.#shut(CloseCode.InternalError, "data listener failed"));
    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) this.#inbox.push(new Uint8Array(event.data));
      else this.#shut(CloseCode.UnsupportedData, "binary messages only");
    });
    ws.addEventListener("close", (event: CloseEvent) => this.#finish(event.code, event.reason));
  }

  /** The close code once closed, e.g. 4404 when the host is offline. */
  get closeCode(): number | undefined {
    return this.#closeCode;
  }

  send(bytes: Uint8Array): void {
    if (this.#closed.fired || !isOpen(this.#ws)) throw new LinkClosedError("relay socket is closed");
    if (bytes.byteLength > RELAY_MESSAGE_CAP) {
      throw new RangeError(`${bytes.byteLength} bytes exceed the relay's ${RELAY_MESSAGE_CAP}-byte message cap`);
    }
    this.#ws.send(bytes);
  }

  onData(listener: DataListener): Unsubscribe {
    return this.#inbox.add(listener);
  }

  onClose(listener: CloseListener): Unsubscribe {
    return this.#closed.add(listener);
  }

  close(): void {
    this.#shut(CloseCode.Normal, "");
  }

  #shut(code: number, reason: string): void {
    if (isOpen(this.#ws)) this.#ws.close(code, reason);
    this.#finish(code, reason);
  }

  #finish(code: number, reason: string): void {
    if (this.#closed.fired) return;
    this.#closeCode = code;
    this.#inbox.clear();
    this.#closed.fire(code === CloseCode.Normal ? undefined : new RelayCloseError(code, reason));
  }
}
