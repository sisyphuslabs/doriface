import { hashOf, parseRecord, type Signed } from "@doriface/mesh";

interface RecordIndex {
  readonly prevOf: ReadonlyMap<string, readonly string[]>;
  readonly hashes: readonly string[];
}

const indexes = new WeakMap<readonly Signed[], RecordIndex>();

/** Each record's hash and `prev`, computed once per stored set (the store hands out the same array until it changes). */
export function indexOf(records: readonly Signed[]): RecordIndex {
  const known = indexes.get(records);
  if (known !== undefined) return known;
  const hashes = records.map(hashOf);
  const index = {
    prevOf: new Map(records.map((record, i) => [hashes[i] ?? "", parseRecord(record)?.prev ?? []])),
    hashes,
  };
  indexes.set(records, index);
  return index;
}

/**
 * The stored records outside the past of `peerHeads` (section 5.2), in stored order, which the door keeps
 * topological. Heads this host does not hold are ignored: they say nothing about what the peer lacks here.
 */
export function missingSince(records: readonly Signed[], peerHeads: Iterable<string>): readonly Signed[] {
  const { prevOf, hashes } = indexOf(records);
  const past = new Set<string>();
  const stack = [...peerHeads].filter((hash) => prevOf.has(hash));
  for (let hash = stack.pop(); hash !== undefined; hash = stack.pop()) {
    if (past.has(hash)) continue;
    past.add(hash);
    stack.push(...(prevOf.get(hash) ?? []));
  }
  return records.filter((_, index) => !past.has(hashes[index] ?? ""));
}

/** The highest counter of each signer in `records`: a `hello`'s `n` (section 5.2). */
export function countersOf(records: readonly Signed[]): Record<string, number> {
  const n: Record<string, number> = {};
  for (const record of records) {
    const body = parseRecord(record);
    if (body !== undefined) n[body.by] = Math.max(n[body.by] ?? 0, body.n);
  }
  return n;
}
