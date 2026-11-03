import { AckCounter, keepAlive } from "./flow-control.ts";
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
import { SendWindow } from "./send-window.ts";
import { closeSocket, isOpen } from "./socket.ts";
import { CloseCode, parseCreditText, PING_INTERVAL_MS, PONG } from "./wire/index.ts";

/**
 * A binary relay WebSocket as a ByteLink: one message in, one chunk out. It acks what it receives and pings the relay
 * so the relay neither stalls nor reaps it. A non-normal close carries a RelayCloseError. With `credit` (the link
 * dialed `?credit=1`), the relay's `c:<n>` texts carry the host's consumption and sends past the window wait.
 */
export class WebSocketLink implements ByteLink {
  readonly #ws: WebSocket;
  readonly #inbox: Inbox;
  readonly #closed = new CloseSignal();
  readonly #acks = new AckCounter();
  readonly #stopPings: () => void;
  readonly #window = new SendWindow();
  readonly #credit: boolean;
  #closeCode: number | undefined;

  constructor(ws: WebSocket, pingIntervalMs = PING_INTERVAL_MS, options: { readonly credit?: boolean } = {}) {
    this.#ws = ws;
    this.#credit = options.credit === true;
    ws.binaryType = "arraybuffer";
    this.#inbox = new Inbox(
      (error) => this.#shut(CloseCode.InternalError, "data listener failed", error),
      (chunk) => this.#consumed(chunk.byteLength),
    );
    this.#stopPings = keepAlive(ws, pingIntervalMs);
    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.data === PONG) return;
      if (this.#credit && typeof event.data === "string" && event.data.startsWith("c:")) {
        return this.#credited(event.data);
      }
      if (!(event.data instanceof ArrayBuffer)) return this.#shut(CloseCode.UnsupportedData, "binary messages only");
      this.#inbox.push(new Uint8Array(event.data));
    });
    ws.addEventListener("close", (event: CloseEvent) => this.#finish(event.code, event.reason));
  }

  /** The close code once closed, e.g. 4404 when the host is offline. */
  get closeCode(): number | undefined {
    return this.#closeCode;
  }

  send(bytes: Uint8Array): void {
    if (this.#closed.fired || !isOpen(this.#ws)) throw new LinkClosedError("relay socket is closed");
    if (bytes.byteLength > MAX_SESSION_SEND_BYTES) {
      throw new RangeError(`${bytes.byteLength} bytes exceed the relay's ${MAX_SESSION_SEND_BYTES}-byte session cap`);
    }
    this.#window.admit(
      bytes.byteLength,
      () => {
        if (isOpen(this.#ws)) this.#ws.send(bytes);
      },
      () => {},
    );
  }

  /** Resolves once every send has gone to the socket, none still waiting for credit. */
  drained(): Promise<void> {
    return this.#window.drained();
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

  #credited(text: string): void {
    const bytes = parseCreditText(text);
    if (bytes === undefined || !this.#window.credit(bytes)) this.#shut(CloseCode.RelayProtocolError, "bad credit");
  }

  /** Acks once listeners took the bytes, so a slow consumer slows the sender instead of growing the inbox. */
  #consumed(bytes: number): void {
    const ack = this.#acks.ackFor(bytes);
    if (ack !== undefined && isOpen(this.#ws)) this.#ws.send(ack);
  }

  #shut(code: number, reason: string, cause?: unknown): void {
    if (isOpen(this.#ws)) closeSocket(this.#ws, code, reason);
    this.#finish(code, reason, cause);
  }

  #finish(code: number, reason: string, cause?: unknown): void {
    if (this.#closed.fired) return;
    this.#stopPings();
    this.#closeCode = code;
    this.#inbox.clear();
    this.#window.drop(new LinkClosedError("relay socket is closed"));
    this.#closed.fire(code === CloseCode.Normal ? undefined : new RelayCloseError(code, reason, { cause }));
  }
}
