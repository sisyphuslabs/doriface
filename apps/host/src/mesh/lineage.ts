import { hashOf, parseRecord, type Signed, verifyCard, type View } from "@doriface/mesh";

export const admittedKeys = (view: View): readonly string[] => [...view.members, ...view.overCap];

/**
 * Who admitted each admitted key. `view.admitter` covers the 12 members only (PR 2's `membership()`), so an over-cap
 * key's admitters are the signers of its effective admissions: a key a compromised member admitted past the cap must
 * still be found, or `--compromised` would leave it out and the batch itself would promote it to member.
 */
function overCapAdmissions(records: readonly Signed[], view: View) {
  return records.flatMap((record) => {
    const body = parseRecord(record);
    if (body?.type !== "admit" || !view.eff.has(hashOf(record))) return [];
    const card = body.subject !== undefined && "card" in body.subject ? verifyCard(body.subject.card) : undefined;
    return card !== undefined && view.overCap.has(card.signPub) ? [{ by: body.by, card }] : [];
  });
}

/** The card name of each over-cap key, which `view.name` leaves out like `view.admitter`. */
export const overCapNames = (records: readonly Signed[], view: View): ReadonlyMap<string, string> =>
  new Map(overCapAdmissions(records, view).map(({ card }) => [card.signPub, card.name]));

function admittersOf(records: readonly Signed[], view: View): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, Set<string>>();
  const add = (key: string, admitter: string): void => {
    const set = out.get(key) ?? new Set<string>();
    set.add(admitter);
    out.set(key, set);
  };
  for (const [key, admitter] of view.admitter) add(key, admitter);
  for (const { by, card } of overCapAdmissions(records, view)) add(card.signPub, by);
  return out;
}

/** Every key `root` admitted, transitively, over-cap keys included, in member order. */
export function subtreeOf(records: readonly Signed[], view: View, root: string): readonly string[] {
  const admitters = admittersOf(records, view);
  const tree = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const key of admittedKeys(view)) {
      if (tree.has(key) || ![...(admitters.get(key) ?? [])].some((by) => tree.has(by))) continue;
      tree.add(key);
      grew = true;
    }
  }
  return admittedKeys(view).filter((key) => key !== root && tree.has(key));
}
