import type { Ace, Descriptor } from "./sddl.ts";

export const SYSTEM_SID = "S-1-5-18";
export const ADMINISTRATORS_SID = "S-1-5-32-544";
const OWNER_RIGHTS_SID = "S-1-3-4";
const CREATOR_OWNER_SID = "S-1-3-0";

/** Read access as the file system grants it: FILE_READ_DATA, or any generic right that includes it. */
const READ_DATA = 0x0000_0001;
const GENERIC_READ = 0x8000_0000;
const GENERIC_ALL = 0x1000_0000;

/**
 * What a private file's descriptor says (#406, design revision 3 and 3.1):
 * - `private`: owned by the user, a protected DACL whose only applicable allow is the user's, with read access.
 * - `repairable`: the owner-approved branch (a), where the only extras are SYSTEM and/or Administrators.
 * - `exposed`: another principal has an applicable allow, or the DACL is null; the keys may have been copied.
 * - `unsupported`: a descriptor this host does not trust itself to judge (owner, special trustees, unusable).
 */
export type Custody =
  | { readonly verdict: "private" }
  | { readonly verdict: "repairable" }
  | { readonly verdict: "exposed"; readonly principals: readonly string[] }
  | { readonly verdict: "unsupported"; readonly reason: string };

/** An ACE that grants or denies on the object itself, not one that only passes down to children. */
const appliesToObject = (ace: Ace): boolean => !ace.flags.includes("IO");

const grantsRead = (ace: Ace): boolean => (ace.mask & (READ_DATA | GENERIC_READ | GENERIC_ALL)) !== 0;

export function classifyCustody(descriptor: Descriptor, user: string): Custody {
  const { dacl } = descriptor;
  if (dacl === undefined) return { verdict: "exposed", principals: ["Everyone (no access control list)"] };
  if (descriptor.owner !== user)
    return { verdict: "unsupported", reason: `owned by ${descriptor.owner}, not this user` };
  if (dacl.length === 0) return { verdict: "unsupported", reason: "its access list is empty, so it is unusable" };
  const allows = dacl.filter((ace) => ace.type === "A" && appliesToObject(ace));
  const special = allows.find((ace) => ace.sid === OWNER_RIGHTS_SID || ace.sid === CREATOR_OWNER_SID);
  if (special !== undefined) return { verdict: "unsupported", reason: `it grants the special trustee ${special.sid}` };
  const others = [...new Set(allows.filter((ace) => ace.sid !== user).map((ace) => ace.sid))];
  const exposedTo = others.filter((sid) => sid !== SYSTEM_SID && sid !== ADMINISTRATORS_SID);
  if (exposedTo.length > 0) return { verdict: "exposed", principals: exposedTo };
  const userAllows = allows.filter((ace) => ace.sid === user);
  const userDenied = dacl.some(
    (ace) => ace.type === "D" && appliesToObject(ace) && ace.sid === user && grantsRead(ace),
  );
  if (!userAllows.some(grantsRead) || userDenied) {
    return { verdict: "unsupported", reason: "it does not let this user read it" };
  }
  const inherited = dacl.some((ace) => ace.flags.includes("ID"));
  if (others.length > 0 || !descriptor.protected || inherited) return { verdict: "repairable" };
  return { verdict: "private" };
}
