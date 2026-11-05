import { describe, expect, test } from "bun:test";
import { hostInfoFor, parseHostInfo } from "./host-info.ts";

describe("parseHostInfo", () => {
  test.each(["darwin", "linux", "win32"] as const)("reads %s", (os) => {
    expect(parseHostInfo({ v: 1, os })).toEqual({ v: 1, os });
  });

  test("keeps the members it knows from a newer host's document", () => {
    expect(parseHostInfo({ v: 1, os: "darwin", arch: "arm64" })).toEqual({ v: 1, os: "darwin" });
  });

  test.each([
    ["no document", null],
    ["another version", { v: 2, os: "darwin" }],
    ["an OS it does not name", { v: 1, os: "freebsd" }],
    ["no OS", { v: 1 }],
    ["a string", "darwin"],
  ])("refuses %s", (_, value) => {
    expect(parseHostInfo(value)).toBeUndefined();
  });
});

describe("hostInfoFor", () => {
  test("names the three OSes a host reports, and none other", () => {
    expect(hostInfoFor("darwin")).toEqual({ v: 1, os: "darwin" });
    expect(hostInfoFor("win32")).toEqual({ v: 1, os: "win32" });
    expect(hostInfoFor("freebsd")).toBeUndefined();
  });
});
