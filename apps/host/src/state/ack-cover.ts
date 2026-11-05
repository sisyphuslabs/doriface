// Which of this host's own acks leave the authorize index as it is (#567), so that a fold of the heads persists its
// counter without evaluating the view again.
//
// The index is derived from the view's membership and from which non-ack records count (`indexOf`). Of the whole set,
// the view reads only its revokes (the accusers), its non-ack records (membership) and its witnesses (R3 testimony);
// everything else it reads is a record's past, which a new record does not change. An ack is neither a revoke nor a
// non-ack record, and it testifies only on a conflict between a revoke and a record concurrent with it, both non-acks,
// by holding exactly one of the two in its past. So an ack whose past holds every revoke, and every non-ack record that
// some revoke is not in the past of, changes no non-ack record's status: the view's membership and the index stay as
// they are. Any other ack is evaluated again.

import { hashOf, parseRecord, type Signed } from "@doriface/mesh";

type Bits = Uint32Array;

/** The records of `prev` in an order where each record follows its prev records (a stored set may be in any order). */
function topological(prev: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of prev.keys()) {
    if (seen.has(root)) continue;
    seen.add(root);
    const stack: [string, number][] = [[root, 0]];
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const parents = prev.get(top[0]) ?? [];
      const next = parents[top[1]];
      top[1] += 1;
      if (next === undefined) {
        stack.pop();
        out.push(top[0]);
      } else if (prev.has(next) && !seen.has(next)) {
        seen.add(next);
        stack.push([next, 0]);
      }
    }
  }
  return out;
}

const allOf = (count: number): Bits =>
  Uint32Array.from({ length: (count + 31) >>> 5 }, (_, k) =>
    count - k * 32 >= 32 ? 0xffffffff : (1 << (count - k * 32)) - 1,
  );

const equal = (a: Bits, b: Bits): boolean => a.every((w, k) => w === b[k]);

export class AckCover {
  readonly #prev = new Map<string, readonly string[]>();
  /** The records an inert ack must hold in its past, each with its bit. */
  readonly #watched = new Map<string, number>();
  #all: Bits = new Uint32Array(0);
  /** Per record: the watched records among itself and its past. */
  #covers = new Map<string, Bits>();

  /** Built over the stored records; it stays valid while only this host's acks are added to them. */
  constructor(records: readonly Signed[]) {
    const types = new Map<string, string>();
    for (const record of records) {
      const body = parseRecord(record);
      if (body === undefined) continue;
      this.#prev.set(hashOf(record), body.prev);
      types.set(hashOf(record), body.type);
    }
    const revokes = [...types].flatMap(([hash, type]) => (type === "revoke" ? [hash] : []));
    if (revokes.length === 0) return;
    const order = topological(this.#prev);
    this.#watch(revokes, order);
    const everyRevoke = this.#all;
    const accusable = [...types].flatMap(([hash, type]) =>
      type !== "ack" && type !== "revoke" && !equal(this.#covers.get(hash) ?? new Uint32Array(0), everyRevoke)
        ? [hash]
        : [],
    );
    this.#watch([...revokes, ...accusable], order);
  }

  /** Whether `record`, this host's next record on the stored ones, is an ack that leaves the index as it is. */
  inert(record: Signed): boolean {
    const body = parseRecord(record);
    if (body?.type !== "ack") return false;
    const hash = hashOf(record);
    this.#prev.set(hash, body.prev);
    const bits = this.#covers.get(hash) ?? this.#cover(hash);
    this.#covers.set(hash, bits);
    return equal(bits, this.#all);
  }

  #watch(hashes: readonly string[], order: readonly string[]): void {
    this.#watched.clear();
    for (const hash of hashes) this.#watched.set(hash, this.#watched.size);
    this.#all = allOf(this.#watched.size);
    this.#covers = new Map();
    for (const hash of order) this.#covers.set(hash, this.#cover(hash));
  }

  #cover(hash: string): Bits {
    const bits = new Uint32Array(this.#all.length);
    for (const p of this.#prev.get(hash) ?? []) this.#covers.get(p)?.forEach((w, k) => (bits[k] = (bits[k] ?? 0) | w));
    const bit = this.#watched.get(hash);
    if (bit !== undefined) bits[bit >>> 5] = (bits[bit >>> 5] ?? 0) | (1 << (bit & 31));
    return bits;
  }
}
