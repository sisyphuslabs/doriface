/** Items pushed by callbacks, taken in order by tests. `take` rejects once the queue is ended and empty. */
export class AsyncQueue<T> {
  readonly #items: T[] = [];
  #ended: Error | undefined;
  #wake: (() => void) | undefined;

  push(item: T): void {
    this.#items.push(item);
    this.#notify();
  }

  end(error: Error): void {
    this.#ended ??= error;
    this.#notify();
  }

  get size(): number {
    return this.#items.length;
  }

  async take(): Promise<T> {
    if (this.#items.length > 0) return this.#items.splice(0, 1)[0] ?? this.take();
    if (this.#ended !== undefined) throw this.#ended;
    await new Promise<void>((resolve) => {
      this.#wake = resolve;
    });
    return this.take();
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }
}
