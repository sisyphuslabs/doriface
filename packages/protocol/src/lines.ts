import { MAX_PAYLOAD_BYTES } from "./frame.ts";

const LF = 0x0a;
const EMPTY = new Uint8Array(0);

export class LineTooLongError extends Error {
  override readonly name = "LineTooLongError";
}

/**
 * Splits plain-mode bytes into LF-terminated lines. A line is decoded only once its LF arrived,
 * so a multi-byte character split across chunks decodes intact. The LF itself is not returned.
 */
export class LineDecoder {
  #pending: Uint8Array = EMPTY;
  readonly #decoder = new TextDecoder();
  readonly #maxLineBytes: number;

  constructor(maxLineBytes: number = MAX_PAYLOAD_BYTES) {
    this.#maxLineBytes = maxLineBytes;
  }

  /** Returns at most `maxLines` complete lines; bytes after the last returned line stay buffered. */
  push(chunk: Uint8Array, maxLines: number = Number.POSITIVE_INFINITY): string[] {
    const buf = this.#pending.byteLength === 0 ? chunk : concat(this.#pending, chunk);
    const lines: string[] = [];
    let start = 0;
    while (lines.length < maxLines) {
      const end = buf.indexOf(LF, start);
      if (end === -1) break;
      lines.push(this.#decoder.decode(buf.subarray(start, end)));
      start = end + 1;
    }
    this.#pending = start === buf.byteLength ? EMPTY : buf.slice(start);
    if (lines.length < maxLines && this.#pending.byteLength > this.#maxLineBytes) {
      throw new LineTooLongError(`line exceeds ${this.#maxLineBytes} bytes without a newline`);
    }
    return lines;
  }

  /** Hands back the buffered bytes and forgets them, e.g. the first frames after the hello reply. */
  takeBuffered(): Uint8Array {
    const pending = this.#pending;
    this.#pending = EMPTY;
    return pending;
  }

  get bufferedBytes(): number {
    return this.#pending.byteLength;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}
