/** Runs `step` on each item one after another, for tests where order matters (rate limits, ordered streams). */
export function inOrder<I, T>(items: readonly I[], step: (item: I) => Promise<T>): Promise<T[]> {
  return items.reduce<Promise<T[]>>(async (done, item) => [...(await done), await step(item)], Promise.resolve([]));
}

export const times = (count: number): number[] => Array.from({ length: count }, (_, index) => index);
