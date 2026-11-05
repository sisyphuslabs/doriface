import { FrameDecoder, LineDecoder, parseJsonRpc, type Frame, type JsonRpcRequest } from "@doriface/protocol";
import { createMemoryLinkPair, LinkClosedError, type ByteLink } from "../link.ts";
import { bytes, frame } from "./fixtures.ts";

const FAKE_CORE_WAIT_MS = 2_000;

/**
 * The core side of an in-memory link: it records what the client sent (the hello line, then
 * frames) and lets a test push raw bytes back. Waits are event-driven with a bounded timeout.
 */
export class FakeCore {
  readonly client: ByteLink;
  readonly helloLines: string[] = [];
  readonly frames: Frame[] = [];
  readonly #link: ByteLink;
  readonly #lines = new LineDecoder();
  readonly #decoder = new FrameDecoder();
  readonly #waiters = new Set<() => void>();
  #framed = false;

  constructor() {
    const [client, core] = createMemoryLinkPair();
    this.client = client;
    this.#link = core;
    core.onData((chunk) => this.#receive(chunk));
  }

  push(data: Uint8Array | string): void {
    this.#link.send(typeof data === "string" ? bytes(data) : data);
  }

  pushFrame(channel: number, kind: number, payload: string | Uint8Array = new Uint8Array(0)): void {
    this.push(frame(channel, kind, payload));
  }

  hangUp(): void {
    this.#link.close();
  }

  /** Resolves with the first recorded frame (from `start`) that matches, waiting for it if needed. */
  async waitFrame(match: (frame: Frame) => boolean, start = 0): Promise<Frame> {
    return this.#waitFor(() => this.frames.slice(start).find(match));
  }

  async waitRequest(method: string): Promise<JsonRpcRequest> {
    return this.#waitFor(() => this.requests().find((request) => request.method === method));
  }

  async waitHello(): Promise<string> {
    return this.#waitFor(() => this.helloLines[0]);
  }

  requests(): JsonRpcRequest[] {
    return this.frames
      .filter((f) => f.channel === 0 && f.kind === 0)
      .map((f) => parseJsonRpc(new TextDecoder().decode(f.payload)))
      .filter((message) => message.kind === "request");
  }

  #receive(chunk: Uint8Array): void {
    if (this.#framed) {
      this.frames.push(...this.#decoder.push(chunk));
    } else {
      const [line] = this.#lines.push(chunk, 1);
      if (line !== undefined) {
        this.helloLines.push(line);
        this.#framed = true;
        this.frames.push(...this.#decoder.push(this.#lines.takeBuffered()));
      }
    }
    for (const wake of Array.from(this.#waiters)) wake();
  }

  #waitFor<T>(probe: () => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      const settle = (finish: () => void) => {
        this.#waiters.delete(check);
        clearTimeout(timer);
        finish();
      };
      const check = () => {
        let found: T | undefined;
        try {
          found = probe();
        } catch (error) {
          settle(() => reject(error));
          return;
        }
        if (found !== undefined) settle(() => resolve(found));
      };
      const timer = setTimeout(() => {
        this.#waiters.delete(check);
        reject(new Error(`fake core: nothing matched within ${FAKE_CORE_WAIT_MS} ms`));
      }, FAKE_CORE_WAIT_MS);
      this.#waiters.add(check);
      check();
    });
  }
}

/**
 * `core.client` as a WebSocket that went away before it said so: once `refuse()` runs, every send throws, as a
 * closed socket's does, while no close has been reported yet (#403).
 */
export function refusingLink(core: FakeCore): { readonly link: ByteLink; readonly refuse: () => void } {
  let refused = false;
  const link: ByteLink = {
    send: (data) => {
      if (refused) throw new LinkClosedError("the socket is closed");
      core.client.send(data);
    },
    onData: (listener) => core.client.onData(listener),
    onClose: (listener) => core.client.onClose(listener),
    close: () => core.client.close(),
  };
  return { link, refuse: () => void (refused = true) };
}
