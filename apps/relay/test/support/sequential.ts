/** Runs `step` on each item one after another, for tests where order matters (rate limits, ordered streams). */
export async function inOrder<I, T>(items: readonly I[], step: (item: I) => Promise<T>): Promise<T[]> {
  const [first, ...rest] = items;
  if (first === undefined) return [];
  const head = await step(first);
  return [head, ...(await inOrder(rest, step))];
}

export const times = (count: number): number[] => Array.from({ length: count }, (_, index) => index);
