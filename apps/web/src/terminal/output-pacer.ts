/** At most this much output is written to a terminal per paint: a flood costs each frame a bounded slice (#560). */
export const FRAME_BYTES = 16 * 1024;

interface Pending {
  readonly bytes: Uint8Array;
  /** Hands the stream's credit back once these bytes are written (`TerminalStream.consumed`). */
  readonly credit: (bytes: number) => void;
}

/** Runs a callback on the next animation frame; returns how to cancel it. */
export type FrameTimer = (run: () => void) => () => void;

const nextFrame: FrameTimer = (run) => {
  const id = requestAnimationFrame(run);
  return () => cancelAnimationFrame(id);
};

/**
 * Paces a terminal's output to its paints (#560). Output that arrives is queued and written once a frame, as one batch
 * of at most FRAME_BYTES, and its credit goes back only then: the stream's window then throttles the program to what the
 * page draws, so a flood never fills the main thread and clicks and keys keep their turn. Out of view (a hidden tab),
 * nothing is written: output waits, uncredited, and is written once the terminal shows. Bytes keep their order, and a
 * batch may end inside a character or a sequence: the VT parses a stream.
 */
export class OutputPacer {
  readonly #write: (bytes: Uint8Array) => void;
  readonly #frame: FrameTimer;
  #queue: Pending[] = [];
  #visible = true;
  #cancel: (() => void) | null = null;

  constructor(write: (bytes: Uint8Array) => void, frame: FrameTimer = nextFrame) {
    this.#write = write;
    this.#frame = frame;
  }

  push(bytes: Uint8Array, credit: (bytes: number) => void = () => undefined): void {
    if (bytes.byteLength === 0) return;
    this.#queue.push({ bytes, credit });
    this.#schedule();
  }

  /** Out of view: nothing is written. Back in view: what waited is written from the next frame. */
  setVisible(visible: boolean): void {
    if (visible === this.#visible) return;
    this.#visible = visible;
    this.#cancel?.();
    this.#cancel = null;
    this.#schedule();
  }

  /** Forgets queued output (the stream it came from is gone); its credit is not returned. */
  drop(): void {
    this.#cancel?.();
    this.#cancel = null;
    this.#queue = [];
  }

  #schedule(): void {
    if (this.#cancel !== null || this.#queue.length === 0 || !this.#visible) return;
    const run = (): void => {
      this.#cancel = null;
      this.#flush();
      this.#schedule();
    };
    this.#cancel = this.#frame(run);
  }

  #flush(): void {
    const parts: Uint8Array[] = [];
    const credits: [(bytes: number) => void, number][] = [];
    let size = 0;
    while (size < FRAME_BYTES && this.#queue.length > 0) {
      const head = this.#queue[0];
      if (head === undefined) break;
      const take = Math.min(head.bytes.byteLength, FRAME_BYTES - size);
      parts.push(take === head.bytes.byteLength ? head.bytes : head.bytes.subarray(0, take));
      credits.push([head.credit, take]);
      size += take;
      if (take === head.bytes.byteLength) this.#queue.shift();
      else this.#queue[0] = { bytes: head.bytes.subarray(take), credit: head.credit };
    }
    if (size === 0) return;
    const batch = parts.length === 1 ? (parts[0] ?? new Uint8Array()) : concat(parts, size);
    this.#write(batch);
    for (const [credit, bytes] of credits) credit(bytes);
  }
}

function concat(parts: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}
