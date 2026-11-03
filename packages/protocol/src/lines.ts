import { MAX_PAYLOAD_BYTES } from "./frame.ts";

const LF = 0x0a;
const EMPTY = new Uint8Array(0);

export class LineTooLongError extends Error {
  override readonly name = "LineTooLongError";
}

/**
 * Splits plain-mode bytes into LF-terminated lines. A line is decoded only once its LF arrived,
 * so a multi-byte character split across chunks decodes intact. The LF itself is not returned.
 * Unterminated bytes are kept as a list of chunks and joined once, so a long line arriving in many
 * chunks costs linear time.
 */
export class LineDecoder {
  #parts: Uint8Array[] = [];
  #partBytes = 0;
  #partsMayHoldLf = false;
  readonly #decoder = new TextDecoder();
  readonly #maxLineBytes: number;

  constructor(maxLineBytes: number = MAX_PAYLOAD_BYTES) {
    this.#maxLineBytes = maxLineBytes;
  }

  /** Returns at most `maxLines` complete lines; bytes after the last returned line stay buffered. */
  push(chunk: Uint8Array, maxLines: number = Number.POSITIVE_INFINITY): string[] {
    const input = this.#partsMayHoldLf ? this.#join(chunk) : chunk;
    const lines: string[] = [];
    let start = 0;
    while (lines.length < maxLines) {
      const end = input.indexOf(LF, start);
      if (end === -1) break;
      lines.push(this.#decode(this.#join(input.subarray(start, end))));
      start = end + 1;
    }
    if (start < input.byteLength) {
      this.#parts.push(input.slice(start));
      this.#partBytes += input.byteLength - start;
      this.#partsMayHoldLf = lines.length >= maxLines;
    }
    if (!this.#partsMayHoldLf) this.#assertWithinLimit(this.#partBytes);
    return lines;
  }

  /** Hands back the buffered bytes and forgets them, e.g. the first frames after the hello reply. */
  takeBuffered(): Uint8Array {
    return this.#join(EMPTY);
  }

  get bufferedBytes(): number {
    return this.#partBytes;
  }

  #join(tail: Uint8Array): Uint8Array {
    const parts = this.#parts;
    const total = this.#partBytes + tail.byteLength;
    this.#parts = [];
    this.#partBytes = 0;
    this.#partsMayHoldLf = false;
    if (parts.length === 0) return tail;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of [...parts, tail]) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }

  #decode(line: Uint8Array): string {
    this.#assertWithinLimit(line.byteLength);
    return this.#decoder.decode(line);
  }

  #assertWithinLimit(bytes: number): void {
    if (bytes > this.#maxLineBytes) throw new LineTooLongError(`line exceeds ${this.#maxLineBytes} bytes`);
  }
}
