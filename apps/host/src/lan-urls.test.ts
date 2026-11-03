import { describe, expect, test } from "bun:test";
import { type InterfaceAddress, lanUrlsFor } from "./lan-urls.ts";

const INTERFACES: readonly InterfaceAddress[] = [
  { address: "127.0.0.1", family: "IPv4", internal: true },
  { address: "2001:db8::7", family: "IPv6", internal: false },
  { address: "fe80::7", family: "IPv6", internal: false },
  { address: "192.0.2.7", family: "IPv4", internal: false },
];

describe("lanUrlsFor", () => {
  test("a literal bind advertises itself", () => {
    expect(lanUrlsFor("192.0.2.10", 7766, INTERFACES)).toEqual(["ws://192.0.2.10:7766/v1/e2ee"]);
    expect(lanUrlsFor("2001:db8::1", 7766, INTERFACES)).toEqual(["ws://[2001:db8::1]:7766/v1/e2ee"]);
  });

  test("the IPv4 wildcard advertises the external IPv4 interfaces only", () => {
    expect(lanUrlsFor("0.0.0.0", 7766, INTERFACES)).toEqual(["ws://192.0.2.7:7766/v1/e2ee"]);
  });

  test.each(["::", "::0", "0:0::0", "[::]", "0:0:0:0:0:0:0:0"])(
    "%p is the dual-stack wildcard: external IPv4 then non-link-local IPv6",
    (bind) => {
      expect(lanUrlsFor(bind, 7766, INTERFACES)).toEqual([
        "ws://192.0.2.7:7766/v1/e2ee",
        "ws://[2001:db8::7]:7766/v1/e2ee",
      ]);
    },
  );

  test.each(["fe80::1", "fe80::1%en0", "doriface.local", "999.0.2.10", "192.0.2.256"])(
    "%p advertises nothing",
    (bind) => {
      expect(lanUrlsFor(bind, 7766, INTERFACES)).toEqual([]);
    },
  );
});
