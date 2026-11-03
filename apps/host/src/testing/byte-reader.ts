/** Accumulates a byte stream and hands back whole hc messages: the plain `hello` reply line, then frames. */
export class ByteReader {
  #buffer = new Uint8Array(0);
  #ended = false;
  #wake: (() => void) | undefined;

  push(chunk: Uint8Array): void {
    const next = new Uint8Array(this.#buffer.byteLength + chunk.byteLength);
    next.set(this.#buffer);
    next.set(chunk, this.#buffer.byteLength);
    this.#buffer = next;
    this.#notify();
  }

  end(): void {
    this.#ended = true;
    this.#notify();
  }

  /** One LF-terminated line, LF included. */
  line(): Promise<Uint8Array> {
    return this.#take((buffer) => {
      const lf = buffer.indexOf(0x0a);
      return lf === -1 ? undefined : lf + 1;
    });
  }

  /** One whole frame: the 9-byte header and its payload. */
  frame(): Promise<Uint8Array> {
    return this.#take((buffer) => {
      if (buffer.byteLength < 9) return undefined;
      const size = 9 + new DataView(buffer.buffer, buffer.byteOffset).getUint32(5, true);
      return buffer.byteLength < size ? undefined : size;
    });
  }

  async #take(measure: (buffer: Uint8Array) => number | undefined): Promise<Uint8Array> {
    const size = measure(this.#buffer);
    if (size !== undefined) {
      const out = this.#buffer.slice(0, size);
      this.#buffer = this.#buffer.slice(size);
      return out;
    }
    if (this.#ended) throw new Error(`stream ended with ${this.#buffer.byteLength} unparsed bytes`);
    await new Promise<void>((resolve) => {
      this.#wake = resolve;
    });
    return this.#take(measure);
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }
}
