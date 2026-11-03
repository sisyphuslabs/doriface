import type { CreateSocket } from "@doriface/relay-client";
import { AsyncQueue } from "./queue.ts";

export interface Closed {
  readonly code: number;
  readonly reason: string;
}

const TEST_IP_COUNT = 508;
let issued = 0;

/**
 * A TEST-NET-2 or TEST-NET-3 (RFC 5737) address no other caller in this run got, so each test has its own rate-limit
 * bucket. Running out throws rather than reusing an address another test already spent its budget from.
 */
export function testIp(): string {
  if (issued >= TEST_IP_COUNT) throw new Error(`all ${TEST_IP_COUNT} test IPs were already handed out in this run`);
  const index = issued;
  issued += 1;
  return index < 254 ? `198.51.100.${index + 1}` : `203.0.113.${index - 253}`;
}

/** Bun's WebSocket with the client IP the relay rate-limits on; Cloudflare's edge sets this header in production. */
export function socketFrom(ip: string): CreateSocket {
  return (url) => new WebSocket(url, { headers: { "cf-connecting-ip": ip } });
}

/** A raw binary WebSocket that records every message and the close, for tests that speak the wire directly. */
export class Probe {
  readonly socket: WebSocket;
  readonly closed: Promise<Closed>;
  readonly #messages = new AsyncQueue<Uint8Array>();

  constructor(url: string, ip: string) {
    this.socket = socketFrom(ip)(url);
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) this.#messages.push(new Uint8Array(event.data));
    });
    this.closed = new Promise((resolve) => {
      this.socket.addEventListener("close", (event: CloseEvent) => {
        resolve({ code: event.code, reason: event.reason });
        this.#messages.end(new Error(`socket closed with ${event.code}`));
      });
    });
  }

  /** Resolves once the socket is open; rejects if it closed first. */
  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      void this.closed.then(({ code }) => reject(new Error(`closed with ${code} before opening`)));
    });
  }

  /** The next message; rejects once the socket has closed and every message was taken. */
  next(): Promise<Uint8Array> {
    return this.#messages.take();
  }
}
