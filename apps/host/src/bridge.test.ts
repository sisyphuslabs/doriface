import { describe, expect, test } from "bun:test";
import { bridge } from "./bridge.ts";
import { ByteQueue, type DataHandler, type Link } from "./link.ts";

/** An in-memory Link: `emit` plays the remote peer, `sent` records what the bridge handed to it. */
class MemoryLink implements Link {
  readonly sent: number[][] = [];
  closed = false;
  #gate: PromiseWithResolvers<void> | undefined;
  #failSends = false;
  readonly #closeHandlers: (() => void)[] = [];
  readonly #inbox = new ByteQueue({ onError: () => this.close() });

  emit(...values: number[]): void {
    for (const value of values) this.#inbox.push(Uint8Array.of(value));
  }

  /** Makes every send wait until `release` is called. */
  hold(): void {
    this.#gate = Promise.withResolvers();
  }

  release(): void {
    this.#gate?.resolve();
    this.#gate = undefined;
  }

  failSends(): void {
    this.#failSends = true;
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.#failSends) throw new Error("transport broke");
    this.sent.push([...bytes]);
    await this.#gate?.promise;
  }

  onData(handler: DataHandler): void {
    this.#inbox.setHandler(handler);
  }

  onClose(handler: () => void): void {
    this.#closeHandlers.push(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.#inbox.clear();
    for (const handler of this.#closeHandlers.splice(0)) handler();
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("bridge", () => {
  test("forwards every chunk in order, both directions, bytes untouched", async () => {
    const a = new MemoryLink();
    const b = new MemoryLink();
    void bridge(a, b);
    const values = Array.from({ length: 200 }, (_, i) => i);
    a.emit(...values);
    b.emit(...values.toReversed());
    await settle();
    expect(b.sent).toEqual(values.map((v) => [v]));
    expect(a.sent).toEqual(values.toReversed().map((v) => [v]));
  });

  test("does not hand on the next chunk until the receiver took the previous one", async () => {
    const a = new MemoryLink();
    const b = new MemoryLink();
    void bridge(a, b);
    b.hold();
    a.emit(1, 2, 3);
    await settle();
    expect(b.sent).toEqual([[1]]);
    b.release();
    b.hold();
    await settle();
    expect(b.sent).toEqual([[1], [2]]);
    b.release();
    await settle();
    expect(b.sent).toEqual([[1], [2], [3]]);
  });

  test.each(["a", "b"] as const)("closing side %s closes both and settles the bridge", async (side) => {
    const a = new MemoryLink();
    const b = new MemoryLink();
    const done = bridge(a, b);
    (side === "a" ? a : b).close();
    await done;
    expect([a.closed, b.closed]).toEqual([true, true]);
  });

  test("a failed send closes both sides and reports the error", async () => {
    const a = new MemoryLink();
    const b = new MemoryLink();
    const errors: unknown[] = [];
    const done = bridge(a, b, (error) => errors.push(error));
    b.failSends();
    a.emit(7);
    await done;
    expect([a.closed, b.closed]).toEqual([true, true]);
    expect(errors.map(String)).toEqual(["Error: transport broke"]);
  });

  test("chunks arriving after close are dropped", async () => {
    const a = new MemoryLink();
    const b = new MemoryLink();
    const done = bridge(a, b);
    a.close();
    await done;
    a.emit(9);
    await settle();
    expect(b.sent).toEqual([]);
  });
});
