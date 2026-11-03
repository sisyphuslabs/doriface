import { describe, expect, test } from "bun:test";
import { lanUrlsFor } from "./lan-urls.ts";

describe("lanUrlsFor", () => {
  test("a literal bind advertises itself", () => {
    expect(lanUrlsFor("192.0.2.10", 7766)).toEqual(["ws://192.0.2.10:7766/v1/e2ee"]);
    expect(lanUrlsFor("2001:db8::1", 7766)).toEqual(["ws://[2001:db8::1]:7766/v1/e2ee"]);
  });

  test.each(["::0", "0:0::0", "[::]", "0:0:0:0:0:0:0:0"])("%p is the IPv6 wildcard, not a dialable literal", (bind) => {
    expect(lanUrlsFor(bind, 7766)).toEqual(lanUrlsFor("::", 7766));
    expect(lanUrlsFor(bind, 7766).some((url) => url.includes("[::]"))).toBe(false);
  });

  test.each(["fe80::1", "fe80::1%en0", "doriface.local", "999.0.2.10", "192.0.2.256"])(
    "%p advertises nothing",
    (bind) => {
      expect(lanUrlsFor(bind, 7766)).toEqual([]);
    },
  );
});
