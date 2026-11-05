import { describe, expect, test } from "bun:test";
import { classifyCustody, type Custody } from "./classify.ts";
import { parseSddl, SddlError } from "./sddl.ts";

const USER = "S-1-5-21-1000-2000-3000-1001";
const OTHER = "S-1-5-21-1000-2000-3000-1002";
const custody = (sddl: string) => classifyCustody(parseSddl(sddl), USER);

describe("classifyCustody (#406 design revision 3 and 3.1)", () => {
  const rows: readonly (readonly [string, string, Custody["verdict"]])[] = [
    ["S1 owner-only, protected", `O:${USER}D:P(A;;FA;;;${USER})`, "private"],
    [
      "S2 SYSTEM and Administrators extras, inherited from a profile",
      `O:${USER}D:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;${USER})`,
      "repairable",
    ],
    ["S3 Users can read", `O:${USER}D:P(A;;FA;;;${USER})(A;;FR;;;BU)`, "exposed"],
    ["S4 Everyone can read", `O:${USER}D:P(A;;FA;;;${USER})(A;;GR;;;WD)`, "exposed"],
    ["S5 Authenticated Users can read", `O:${USER}D:P(A;;FA;;;${USER})(A;;0x120089;;;AU)`, "exposed"],
    ["S6 another account can write", `O:${USER}D:P(A;;FA;;;${USER})(A;;FW;;;${OTHER})`, "exposed"],
    ["S7 a null DACL", `O:${USER}D:NO_ACCESS_CONTROL`, "exposed"],
    ["S8 an empty DACL", `O:${USER}D:P`, "unsupported"],
    ["S10 OWNER RIGHTS", `O:${USER}D:P(A;;FA;;;${USER})(A;;FA;;;OW)`, "unsupported"],
    ["S10 CREATOR OWNER on the object", `O:${USER}D:P(A;;FA;;;${USER})(A;;FA;;;CO)`, "unsupported"],
    [
      "S11 an inherit-only grant to Users does not apply to the file",
      `O:${USER}D:P(A;;FA;;;${USER})(A;OICIIO;FA;;;BU)`,
      "private",
    ],
    ["S12 hex rights for another account", `O:${USER}D:P(A;;FA;;;${USER})(A;;0x1;;;${OTHER})`, "exposed"],
    ["S13 a deny on the user's read", `O:${USER}D:P(D;;FR;;;${USER})(A;;FA;;;${USER})`, "unsupported"],
    [
      "S13 a deny on another account does not excuse its grant",
      `O:${USER}D:P(D;;FW;;;BU)(A;;FA;;;${USER})(A;;FR;;;BU)`,
      "exposed",
    ],
    ["S14 owned by another account", `O:${OTHER}D:P(A;;FA;;;${USER})`, "unsupported"],
    ["S14 owned by Administrators", `O:BAD:P(A;;FA;;;${USER})`, "unsupported"],
    ["S15 an inherited owner-only ACE", `O:${USER}D:(A;ID;FA;;;${USER})`, "repairable"],
    ["S16 owner-only but unprotected", `O:${USER}D:(A;;FA;;;${USER})`, "repairable"],
    ["the user without read access", `O:${USER}D:P(A;;FW;;;${USER})`, "unsupported"],
  ];
  for (const [name, sddl, verdict] of rows) {
    test(name, () => {
      expect(custody(sddl).verdict).toBe(verdict);
    });
  }

  test("an exposed file names every other principal once, and never SYSTEM or Administrators", () => {
    const result = custody(`O:${USER}D:(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FR;;;BU)(A;;FR;;;BU)(A;;FR;;;${OTHER})`);
    expect(result).toEqual({ verdict: "exposed", principals: ["S-1-5-32-545", OTHER] });
  });
});

describe("parseSddl refuses what a private file may not carry (S9)", () => {
  for (const [name, sddl] of [
    ["an object ACE", `O:${USER}D:P(OA;;FA;bf967aba-0de6-11d0-a285-00aa003049e2;;${USER})`],
    ["a callback ACE", `O:${USER}D:P(XA;;FA;;;${USER};(Member_of {SID(BA)}))`],
    ["an object field on a plain ACE", `O:${USER}D:P(A;;FA;bf967aba-0de6-11d0-a285-00aa003049e2;;${USER})`],
    ["an unknown alias", `O:${USER}D:P(A;;FA;;;ZZ)`],
    ["an unknown right", `O:${USER}D:P(A;;QQ;;;${USER})`],
    ["an unknown flag", `O:${USER}D:P(A;XX;FA;;;${USER})`],
    ["a SACL", `O:${USER}D:P(A;;FA;;;${USER})S:(AU;SA;FA;;;WD)`],
    ["a group section", `O:${USER}G:SYD:P(A;;FA;;;${USER})`],
    ["no owner", `D:P(A;;FA;;;${USER})`],
    ["an ACE with no rights", `O:${USER}D:P(A;;;;;${USER})`],
  ] as const) {
    test(name, () => {
      expect(() => parseSddl(sddl)).toThrow(SddlError);
    });
  }

  test("aliases expand to SIDs and named rights to a mask", () => {
    expect(parseSddl(`O:SYD:P(A;OICI;FA;;;BA)`)).toEqual({
      owner: "S-1-5-18",
      protected: true,
      dacl: [{ type: "A", flags: "OICI", mask: 0x001f01ff, sid: "S-1-5-32-544" }],
    });
  });
});
