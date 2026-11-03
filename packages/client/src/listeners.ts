export type Unsubscribe = () => void;

/**
 * A listener set that keeps one throwing listener from breaking the frame loop: the error is
 * rethrown on a microtask, so it still surfaces as an unhandled error instead of vanishing.
 */
export class Listeners<T> {
  readonly #listeners = new Set<(value: T) => void>();

  add(listener: (value: T) => void): Unsubscribe {
    const wrapped = (value: T) => listener(value);
    this.#listeners.add(wrapped);
    return () => {
      this.#listeners.delete(wrapped);
    };
  }

  emit(value: T): void {
    for (const listener of Array.from(this.#listeners)) {
      try {
        listener(value);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  get size(): number {
    return this.#listeners.size;
  }

  clear(): void {
    this.#listeners.clear();
  }
}
