/** Items pushed by callbacks, taken in order by tests. `take` rejects once the queue is ended and empty. */
export class AsyncQueue<T> {
  readonly #items: { readonly value: T }[] = [];
  readonly #waiters: (() => void)[] = [];
  #ended: Error | undefined;

  push(value: T): void {
    this.#items.push({ value });
    this.#waiters.shift()?.();
  }

  end(error: Error): void {
    this.#ended ??= error;
    for (const wake of this.#waiters.splice(0)) wake();
  }

  get size(): number {
    return this.#items.length;
  }

  async take(): Promise<T> {
    const item = this.#items.shift();
    if (item !== undefined) return item.value;
    if (this.#ended !== undefined) throw this.#ended;
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
    return this.take();
  }
}
