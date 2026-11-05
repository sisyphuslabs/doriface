import { describe, expect, test } from "bun:test";
import { checkNamespace, type ChainFolder, TRUSTED_INSTALLER_SID } from "./namespace.ts";
import { parseSddl } from "./sddl.ts";

const USER = "S-1-5-21-1000-2000-3000-1001";
const OTHER = "S-1-5-21-1000-2000-3000-1002";
const folder = (path: string, sddl: string, reparsePoint = false): ChainFolder => ({
  path,
  descriptor: parseSddl(sddl),
  reparsePoint,
});

/** A standard Windows profile chain, from the state folder up to C:\. */
const PROFILE_CHAIN = [
  folder("C:\\Users\\q\\.local\\state\\doriface-host", `O:${USER}D:P(A;OICI;FA;;;${USER})`),
  folder("C:\\Users\\q\\.local\\state", `O:${USER}D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${USER})`),
  folder("C:\\Users\\q\\.local", `O:${USER}D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${USER})`),
  folder("C:\\Users\\q", `O:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${USER})`),
  folder("C:\\Users", `O:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)(A;OICI;0x1200a9;;;WD)`),
  folder(
    "C:\\",
    `O:${TRUSTED_INSTALLER_SID}D:P(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)(A;OICI;0x1200a9;;;BU)(A;;0x4;;;AU)(A;OICIIO;0x1301bf;;;AU)`,
  ),
];

describe("checkNamespace (#406 design revision 3.2)", () => {
  test("N6 the standard profile chain is trusted", () => {
    expect(checkNamespace(PROFILE_CHAIN, USER)).toEqual({ verdict: "trusted" });
  });

  for (const [name, rights] of [
    ["N1 WRITE_DAC", "WD"],
    ["N1 WRITE_OWNER", "WO"],
    ["N1 DELETE", "SD"],
    ["N1 FILE_DELETE_CHILD", "DT"],
    ["N2 GENERIC_ALL", "GA"],
    ["N2 GENERIC_WRITE", "GW"],
    ["N2 a hex mask with FILE_DELETE_CHILD", "0x40"],
  ] as const) {
    test(`${name} granted to another account on the parent is untrusted`, () => {
      const chain = [PROFILE_CHAIN[0], folder("D:\\shared", `O:${USER}D:P(A;;FA;;;${USER})(A;;${rights};;;${OTHER})`)];
      expect(
        checkNamespace(
          chain.filter((entry) => entry !== undefined),
          USER,
        ),
      ).toMatchObject({
        verdict: "untrusted",
        path: "D:\\shared",
      });
    });
  }

  test("N3 a folder owned by another account is untrusted", () => {
    const chain = [folder("D:\\theirs", `O:${OTHER}D:P(A;;FA;;;${USER})`)];
    expect(checkNamespace(chain, USER)).toMatchObject({ verdict: "untrusted", path: "D:\\theirs" });
  });

  test("N4 an inherit-only grant does not apply to the folder itself", () => {
    const chain = [folder("D:\\x", `O:${USER}D:P(A;;FA;;;${USER})(A;OICIIO;FA;;;${OTHER})`)];
    expect(checkNamespace(chain, USER)).toEqual({ verdict: "trusted" });
  });

  test("N5 a reparse point anywhere in the chain is untrusted", () => {
    const chain = PROFILE_CHAIN.map((entry, index) =>
      index === 2 ? Object.assign({}, entry, { reparsePoint: true }) : entry,
    );
    expect(checkNamespace(chain, USER)).toMatchObject({ verdict: "untrusted", path: "C:\\Users\\q\\.local" });
  });

  test("read and create-subfolder rights for others are not namespace rights", () => {
    const chain = [folder("D:\\x", `O:${USER}D:P(A;;FA;;;${USER})(A;;0x1200a9;;;BU)(A;;0x4;;;AU)`)];
    expect(checkNamespace(chain, USER)).toEqual({ verdict: "trusted" });
  });
});
