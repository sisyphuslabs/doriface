import { hashOf, parseRecord, type Signed, verifyCard, type View } from "@doriface/mesh";

export const admittedKeys = (view: View): readonly string[] => [...view.members, ...view.overCap];

/** The card name of each over-cap key, from its governing admission: `view.name` holds members only. */
export function overCapNames(records: readonly Signed[], view: View): ReadonlyMap<string, string> {
  const governing = new Set([...view.overCap].flatMap((key) => view.governing.get(key) ?? []));
  return new Map(
    records.flatMap((record) => {
      if (!governing.has(hashOf(record))) return [];
      const subject = parseRecord(record)?.subject;
      const card = subject !== undefined && "card" in subject ? verifyCard(subject.card) : undefined;
      return card === undefined ? [] : [[card.signPub, card.name] as const];
    }),
  );
}

/**
 * Every key `root` admitted, transitively, in member order: the view's admitter map (design 6.1), which names one
 * admitter per key, the signer of its governing admission, for over-cap keys as well as members.
 */
export function subtreeOf(view: View, root: string): readonly string[] {
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const key of admittedKeys(view)) {
      const admitter = view.admitter.get(key);
      if (tree.has(key) || admitter === undefined || !tree.has(admitter)) continue;
      tree.add(key);
      grew = true;
    }
  }
  return admittedKeys(view).filter((key) => key !== root && tree.has(key));
}
