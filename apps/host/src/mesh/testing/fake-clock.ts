import type { Clock, Random } from "../clock.ts";

interface Timer {
  readonly at: number;
  readonly seq: number;
  readonly run: () => void;
}

/**
 * WebCrypto work this test process has started and not yet seen settle. Its promises resolve on a later event-loop turn
 * (a Noise handshake's X25519, for one), so a chain through it is not finished when the turn that started it ends.
 */
let cryptoInFlight = 0;
const COUNTED = Symbol.for("doriface.fake-clock.counted-subtle");
const subtle = globalThis.crypto.subtle as SubtleCrypto & { [COUNTED]?: true };
if (subtle[COUNTED] === undefined) {
  subtle[COUNTED] = true;
  for (const name of [
    "decrypt",
    "deriveBits",
    "deriveKey",
    "digest",
    "encrypt",
    "exportKey",
    "generateKey",
    "importKey",
    "sign",
    "unwrapKey",
    "verify",
    "wrapKey",
  ] as const) {
    const original = subtle[name].bind(subtle) as (...args: unknown[]) => Promise<unknown>;
    Object.defineProperty(subtle, name, {
      configurable: true,
      value: (...args: unknown[]): Promise<unknown> => {
        cryptoInFlight += 1;
        return original(...args).finally(() => {
          cryptoInFlight -= 1;
        });
      },
    });
  }
}

/** Turns with nothing in flight before settle() calls the process quiet: one drains every microtask, one more confirms. */
const QUIET_TURNS = 2;
/** A chain still going after this many turns is a leak (a loop that never yields), not work to wait for. */
const MAX_TURNS = 10_000;

const turn = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Lets every promise chain a step started run to its end, without letting any time pass. It returns at a quiet point:
 * {@link QUIET_TURNS} event-loop turns in a row with no WebCrypto work in flight (each turn drains every microtask,
 * which is how the in-memory links deliver). A fixed turn count made timer-heavy tests cost tens of thousands of turns
 * whatever they did, so their run time followed the runner's event-loop latency (#316, #323).
 */
export async function settle(quiet = 0, turns = 0): Promise<void> {
  if (quiet >= QUIET_TURNS) return;
  if (turns >= MAX_TURNS) throw new Error(`settle(): still busy after ${MAX_TURNS} event-loop turns`);
  await turn();
  return settle(cryptoInFlight === 0 ? quiet + 1 : 0, turns + 1);
}

/** Virtual time: timers fire only inside `advance`, in due order, each followed by `settle()`. */
export class FakeClock implements Clock {
  #now = 0;
  #seq = 0;
  #timers: Timer[] = [];

  now(): number {
    return this.#now;
  }

  after(ms: number, run: () => void): () => void {
    const timer = { at: this.#now + Math.max(0, ms), seq: this.#seq++, run };
    this.#timers.push(timer);
    return () => {
      this.#timers = this.#timers.filter((entry) => entry !== timer);
    };
  }

  async advance(ms: number): Promise<void> {
    await settle();
    return this.#fireUntil(this.#now + ms);
  }

  async #fireUntil(end: number): Promise<void> {
    const due = this.#timers.filter((timer) => timer.at <= end).toSorted((a, b) => a.at - b.at || a.seq - b.seq);
    const next = due[0];
    if (next === undefined) {
      this.#now = end;
      return settle();
    }
    this.#timers = this.#timers.filter((timer) => timer !== next);
    this.#now = next.at;
    next.run();
    await settle();
    return this.#fireUntil(end);
  }

  /**
   * `advance` for a subject driven by timers alone: it settles before time moves and after each timer that fires, but
   * not once more when nothing fired, since time moving on runs nothing by itself. Saves 25 event-loop turns per quiet
   * step (#316).
   */
  async advanceTimers(ms: number): Promise<void> {
    await settle();
    return this.#fireTimers(this.#now + ms);
  }

  /**
   * `until` for a subject driven by timers alone: it goes from timer to timer instead of stepping through quiet virtual
   * time, so it spends event-loop turns on the timers that fire, not on every `stepMs` slice. A test whose state also
   * moves by promise chains that outlast one `settle()` (a sync session across hosts) must keep `until` (#316).
   */
  async untilTimers(done: () => boolean, limitMs: number, start = this.#now): Promise<number> {
    await settle();
    if (done()) return this.#now - start;
    const next = this.#due(start + limitMs);
    if (next === undefined) throw new Error(`not reached within ${limitMs} ms of virtual time`);
    await this.#fireTimers(next.at);
    return this.untilTimers(done, limitMs, start);
  }

  async #fireTimers(end: number): Promise<void> {
    const next = this.#due(end);
    if (next === undefined) {
      this.#now = end;
      return;
    }
    this.#timers = this.#timers.filter((timer) => timer !== next);
    this.#now = next.at;
    next.run();
    await settle();
    return this.#fireTimers(end);
  }

  #due(end: number): Timer | undefined {
    return this.#timers.filter((timer) => timer.at <= end).toSorted((a, b) => a.at - b.at || a.seq - b.seq)[0];
  }

  /** Advances in steps until `done()` holds, and returns the virtual time it took; throws past `limitMs`. */
  async until(done: () => boolean, limitMs: number, stepMs = 250, start = this.#now): Promise<number> {
    await settle();
    if (done()) return this.#now - start;
    if (this.#now - start >= limitMs) throw new Error(`not reached within ${limitMs} ms of virtual time`);
    await this.advance(stepMs);
    return this.until(done, limitMs, stepMs, start);
  }
}

/** mulberry32: a small seeded generator, so jitter is reproducible. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
