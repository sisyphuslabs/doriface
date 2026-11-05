/**
 * The part of the Windows security descriptor string format (SDDL) that a private state file may carry: an owner and
 * a DACL of plain allow and deny ACEs (#406). Anything outside it is a parse error, so the caller refuses the file.
 */

export interface Ace {
  readonly type: "A" | "D";
  /** Inheritance flags, e.g. "OICI", "ID", "IO". */
  readonly flags: string;
  /** The access mask as a number, from named, generic or hex rights. */
  readonly mask: number;
  /** A SID string (`S-1-…`); well-known aliases are expanded. */
  readonly sid: string;
}

export interface Descriptor {
  readonly owner: string;
  /** Undefined for a null DACL (everyone has access); an empty array is an empty DACL (nobody does). */
  readonly dacl: readonly Ace[] | undefined;
  readonly protected: boolean;
}

export class SddlError extends Error {
  override readonly name = "SddlError";
}

/** Well-known SID aliases (Microsoft "SID strings"). An alias not listed here is refused, never guessed. */
const ALIASES: Readonly<Record<string, string>> = {
  SY: "S-1-5-18",
  BA: "S-1-5-32-544",
  BU: "S-1-5-32-545",
  BG: "S-1-5-32-546",
  WD: "S-1-1-0",
  AU: "S-1-5-11",
  AN: "S-1-5-7",
  IU: "S-1-5-4",
  NU: "S-1-5-2",
  SU: "S-1-5-6",
  NS: "S-1-5-20",
  LS: "S-1-5-19",
  OW: "S-1-3-4",
  CO: "S-1-3-0",
  CG: "S-1-3-1",
  AC: "S-1-15-2-1",
};

/** File access rights by their SDDL names (Microsoft "ACE strings"). */
const RIGHTS: Readonly<Record<string, number>> = {
  GA: 0x1000_0000,
  GX: 0x2000_0000,
  GW: 0x4000_0000,
  GR: 0x8000_0000,
  FA: 0x001f_01ff,
  FR: 0x0012_0089,
  FW: 0x0012_0116,
  FX: 0x0012_00a0,
  RC: 0x0002_0000,
  SD: 0x0001_0000,
  WD: 0x0004_0000,
  WO: 0x0008_0000,
  CC: 0x0000_0001,
  DC: 0x0000_0002,
  LC: 0x0000_0004,
  SW: 0x0000_0008,
  RP: 0x0000_0010,
  WP: 0x0000_0020,
  DT: 0x0000_0040,
  LO: 0x0000_0080,
  CR: 0x0000_0100,
};

const INHERIT_FLAGS = /^(?:OI|CI|NP|IO|ID)*$/;
const SID = /^S-1-\d+(?:-\d+)+$/;

/** Resolves an SDDL alias the table cannot, e.g. a domain-relative one like `LA`; undefined when it is not one. */
export type AliasResolver = (alias: string) => string | undefined;

function sidOf(token: string, resolve: AliasResolver | undefined): string {
  if (SID.test(token)) return token;
  const alias = ALIASES[token] ?? (/^[A-Z]{2}$/.test(token) ? resolve?.(token) : undefined);
  if (alias === undefined || !SID.test(alias)) throw new SddlError(`unknown SID or alias ${JSON.stringify(token)}`);
  return alias;
}

function maskOf(rights: string): number {
  if (rights === "") throw new SddlError("an ACE with no rights");
  if (/^0x[0-9a-fA-F]{1,8}$/.test(rights)) return Number.parseInt(rights.slice(2), 16) >>> 0;
  if (rights.length % 2 !== 0) throw new SddlError(`rights ${JSON.stringify(rights)} are not two-letter names`);
  let mask = 0;
  for (let index = 0; index < rights.length; index += 2) {
    const right = RIGHTS[rights.slice(index, index + 2)];
    if (right === undefined) throw new SddlError(`unknown right ${JSON.stringify(rights.slice(index, index + 2))}`);
    mask = (mask | right) >>> 0;
  }
  return mask;
}

function parseAce(body: string, resolve: AliasResolver | undefined): Ace {
  const fields = body.split(";");
  if (fields.length !== 6) throw new SddlError(`an ACE needs 6 fields, got ${String(fields.length)}`);
  const [type = "", flags = "", rights = "", object = "", inheritObject = "", sid = ""] = fields;
  // Object, callback, conditional, audit, alarm and resource ACEs are outside what a private file may carry.
  if (type !== "A" && type !== "D") throw new SddlError(`unsupported ACE type ${JSON.stringify(type)}`);
  if (!INHERIT_FLAGS.test(flags)) throw new SddlError(`unsupported ACE flags ${JSON.stringify(flags)}`);
  if (object !== "" || inheritObject !== "") throw new SddlError("an object ACE");
  return { type, flags, mask: maskOf(rights), sid: sidOf(sid, resolve) };
}

/** Parses `O:<sid>D:<flags>(<ace>)…`; any other section (group, SACL) or any unsupported token throws SddlError. */
export function parseSddl(sddl: string, resolve?: AliasResolver): Descriptor {
  const match = /^O:([^:()]+?)D:([A-Z_]*)((?:\([^()]*\))*)$/.exec(sddl.trim());
  if (match === null) throw new SddlError("not an owner-and-DACL descriptor");
  const [, ownerToken = "", daclFlags = "", aceText = ""] = match;
  if (!/^(?:P|AI|AR|NO_ACCESS_CONTROL)*$/.test(daclFlags)) throw new SddlError(`unsupported DACL flags ${daclFlags}`);
  const owner = sidOf(ownerToken, resolve);
  if (daclFlags.includes("NO_ACCESS_CONTROL")) {
    if (aceText !== "") throw new SddlError("a null DACL with ACEs");
    return { owner, dacl: undefined, protected: daclFlags.includes("P") };
  }
  const dacl =
    aceText === ""
      ? []
      : aceText
          .slice(1, -1)
          .split(")(")
          .map((ace) => parseAce(ace, resolve));
  return { owner, dacl, protected: daclFlags.includes("P") };
}
