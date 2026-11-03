import {
  hashOf,
  parseRecord,
  type Signed,
  type Subject,
  verifyCard,
  type View,
  viewOf,
  witnessPool,
} from "@doriface/mesh";

// The revoke-time witness pool around `witnessPool` of packages/mesh (design section 6.1): which subjects a revoke
// written by this host leaves undecidable, who could write it instead, and who X could eject by backdating.

/** Per subject with an empty pool from `self`, the current members whose position has a non-empty one. */
export function undecidableFrom(
  records: readonly Signed[],
  view: View,
  self: string,
  subjects: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const own = witnessPool(records, self, subjects);
  const empty = subjects.filter((subject) => (own.get(subject) ?? []).length === 0);
  if (empty.length === 0) return new Map();
  const candidates = [...view.members].filter((key) => key !== self && !subjects.includes(key));
  const pools = candidates.map((key) => [key, witnessPool(records, key, subjects)] as const);
  return new Map(
    empty.map((subject) => [
      subject,
      pools.filter(([, pool]) => (pool.get(subject) ?? []).length > 0).map(([key]) => key),
    ]),
  );
}

/** The pool for one subject from `self`, and the member to ask when it is empty (`mesh status`'s witnessPool). */
export function witnessFacts(
  records: readonly Signed[],
  view: View,
  self: string,
  subject: string,
): { readonly pool: readonly string[]; readonly ask: string | null } {
  const pool = witnessPool(records, self, [subject]).get(subject) ?? [];
  if (pool.length > 0) return { pool, ask: null };
  return { pool, ask: undecidableFrom(records, view, self, [subject]).get(subject)?.[0] ?? null };
}

/**
 * The members other than `subject` at its last own record (its admission if it never wrote): the members a backdated
 * record of its key could eject, the same position `witnessPool` starts from.
 */
export function presentAt(records: readonly Signed[], subject: string): readonly string[] {
  const parsed = records.map((record) => ({ record, hash: hashOf(record), body: parseRecord(record) }));
  const own = parsed
    .filter(({ body }) => body?.by === subject && body.type !== "found")
    .toSorted((a, b) => (b.body?.n ?? 0) - (a.body?.n ?? 0))[0];
  const last = own ?? parsed.find(({ body }) => admits(body?.subject, subject));
  if (last === undefined) return [];
  const byHash = new Map(parsed.map((entry) => [entry.hash, entry]));
  const past = new Set<string>();
  const queue = [...(last.body?.prev ?? [])];
  for (let hash = queue.pop(); hash !== undefined; hash = queue.pop()) {
    if (past.has(hash)) continue;
    past.add(hash);
    queue.push(...(byHash.get(hash)?.body?.prev ?? []));
  }
  const before = parsed.filter(({ hash }) => past.has(hash)).map(({ record }) => record);
  return [...viewOf(before).members].filter((key) => key !== subject);
}

const admits = (subject: Subject | undefined, key: string): boolean =>
  subject !== undefined && "card" in subject && verifyCard(subject.card)?.signPub === key;
