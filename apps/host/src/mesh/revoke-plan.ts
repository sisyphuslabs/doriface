import { MAX_REVOKE_SUBJECTS, presentAt, type Signed, type View, ViewCache } from "@doriface/mesh";
import type { MemberRef } from "./command-replies.ts";
import { admittedKeys, overCapNames, subtreeOf } from "./lineage.ts";
import { hostIdOfKey } from "./status.ts";
import { undecidableFrom } from "./witness.ts";

export interface Undecidable {
  readonly subject: MemberRef;
  readonly present: readonly MemberRef[];
  readonly askFrom: readonly MemberRef[];
}

/** What `mesh revoke [--compromised] <member>` would write from this host, and what it says first (design 6.1). */
export interface RevokePlan {
  readonly keys: readonly string[];
  readonly reason: "revoke" | "compromised";
  readonly target: MemberRef;
  readonly subjects: readonly MemberRef[];
  readonly subtree: readonly MemberRef[];
  readonly undecidable: readonly Undecidable[];
  readonly lines: readonly string[];
  readonly needsYes: boolean;
}

export const memberRef = (view: View, key: string, cardNames?: ReadonlyMap<string, string>): MemberRef => ({
  hostId: hostIdOfKey(key),
  name: view.name.get(key) ?? cardNames?.get(key) ?? hostIdOfKey(key),
});

/**
 * The admitted key a member reference names in `view`: an exact hostId first, then a mesh name, so a member renamed
 * to another member's hostId cannot redirect a revoke of that host.
 */
export const findMember = (view: View, ref: string): string | undefined =>
  admittedKeys(view).find((key) => hostIdOfKey(key) === ref) ??
  admittedKeys(view).find((key) => view.name.get(key) === ref);

const names = (refs: readonly MemberRef[]): string => refs.map((ref) => ref.name).join(", ");

function warningOf(u: Undecidable): string {
  const x = u.subject.name;
  if (u.askFrom.length === 0) {
    return `this mesh cannot decide a backdated attack by ${x}; if ${x}'s key is compromised, re-found the mesh`;
  }
  const ejected = names(u.present) || "no member";
  return (
    `no other member can witness this revoke; ${x}'s key could later eject ${ejected} by backdating; ` +
    `revoke from ${names(u.askFrom)} instead, or re-found if ${x}'s key is compromised`
  );
}

function previewOf(target: MemberRef, subtree: readonly MemberRef[], compromised: boolean): readonly string[] {
  const x = target.name;
  if (compromised) {
    return subtree.length === 0
      ? [`--compromised revokes ${x}; it admitted no member`]
      : [`--compromised revokes ${x} and every member it admitted, transitively: ${names(subtree)}`];
  }
  if (subtree.length === 0) return [];
  const count = `${subtree.length} member${subtree.length === 1 ? "" : "s"}`;
  return [
    `${x} admitted ${count} (${names(subtree)}): if ${x}'s keys are compromised, run mesh revoke --compromised ${x}`,
  ];
}

export function planRevoke(
  records: readonly Signed[],
  view: View,
  self: string,
  ref: string,
  compromised: boolean,
  cache: ViewCache = new ViewCache(),
): RevokePlan {
  const key = findMember(view, ref);
  if (key === undefined) throw new Error(`no member "${ref}" in this host's view of the mesh`);
  if (key === self) throw new Error("that is this host: to take it out of the mesh, run doriface-host mesh leave");
  const subtree = subtreeOf(records, view, key);
  const keys = compromised ? [key, ...subtree] : [key];
  if (keys.length > MAX_REVOKE_SUBJECTS) {
    throw new Error(`--compromised would name ${keys.length} keys; one revoke names at most ${MAX_REVOKE_SUBJECTS}`);
  }
  const cardNames = overCapNames(records, view);
  const toRef = (k: string): MemberRef => memberRef(view, k, cardNames);
  const undecidable = [...undecidableFrom(records, view, self, keys, cache)].map(([subject, askFrom]) => ({
    subject: toRef(subject),
    present: presentAt(records, subject, cache).map(toRef),
    askFrom: askFrom.map(toRef),
  }));
  const target = toRef(key);
  return {
    keys,
    reason: compromised ? "compromised" : "revoke",
    target,
    subjects: keys.map(toRef),
    subtree: subtree.map(toRef),
    undecidable,
    lines: [...previewOf(target, subtree.map(toRef), compromised), ...undecidable.map(warningOf)],
    needsYes: compromised || undecidable.length > 0,
  };
}
