import type { EventFeed, TerminalStream } from "@doriface/client";
import type { HcEvent } from "@doriface/protocol";

const STEP_MS = 15_000;

export function within<T>(promise: Promise<T>, what: string, ms = STEP_MS): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms);
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** Things pushed by a callback, with waits for the first one that matches, past or future. */
class Matches<T> {
  readonly seen: T[] = [];
  readonly #waiters = new Set<{ readonly test: (item: T) => boolean; readonly resolve: (item: T) => void }>();

  push(item: T): void {
    this.seen.push(item);
    for (const waiter of this.#waiters) {
      if (!waiter.test(item)) continue;
      this.#waiters.delete(waiter);
      waiter.resolve(item);
    }
  }

  next(test: (item: T) => boolean, what: string): Promise<T> {
    const found = this.seen.find(test);
    if (found !== undefined) return Promise.resolve(found);
    const { promise, resolve } = Promise.withResolvers<T>();
    this.#waiters.add({ test, resolve });
    return within(promise, what);
  }
}

export interface ScreenWatch {
  text(): string;
  /** Resolves once some output line, trimmed, is exactly `line`. */
  line(line: string): Promise<string>;
  /** Resolves once the output so far contains `text`, escape sequences and all (a first paint has no newlines). */
  contains(text: string): Promise<string>;
}

export function watchScreen(stream: TerminalStream): ScreenWatch {
  const decoder = new TextDecoder();
  const lines = new Matches<string>();
  const snapshots = new Matches<string>();
  let text = "";
  let partial = "";
  stream.onData((bytes) => {
    const chunk = decoder.decode(bytes, { stream: true });
    text += chunk;
    snapshots.push(text);
    const parts = (partial + chunk).split(/\r?\n/);
    partial = parts.pop() ?? "";
    for (const part of parts) lines.push(part.trim());
  });
  return {
    text: () => text,
    line: (line) => lines.next((seen) => seen === line, `the line ${JSON.stringify(line)}`),
    contains: (wanted) =>
      snapshots.next((seen) => seen.includes(wanted), `output containing ${JSON.stringify(wanted)}`),
  };
}

export interface EventWatch {
  readonly seen: readonly HcEvent[];
  next(type: HcEvent["type"], terminal?: string): Promise<HcEvent>;
}

export function watchEvents(feed: EventFeed): EventWatch {
  const events = new Matches<HcEvent>();
  feed.onEvent((event) => events.push(event));
  return {
    seen: events.seen,
    next: (type, terminal) =>
      events.next(
        (event) => event.type === type && (terminal === undefined || event.terminal === terminal),
        `a ${type} event${terminal === undefined ? "" : ` for ${terminal}`}`,
      ),
  };
}
