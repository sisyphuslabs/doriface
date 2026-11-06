import { describe, expect, test } from "bun:test";
import { reachOf } from "./reach.ts";

describe("how this host reaches a member", () => {
  test("the member that is this host is itself", () => {
    expect(reachOf({ line: "self", presence: true })).toBe("this-host");
  });

  test("an open session over a connected line is a direct line", () => {
    expect(reachOf({ line: "connected", presence: true })).toBe("direct-line");
  });

  test("an open session with no connected line arrives through the relay", () => {
    expect(reachOf({ line: "absent", presence: true })).toBe("through-the-relay");
    expect(reachOf({ line: "connecting", presence: true })).toBe("through-the-relay");
  });

  test("a line herdr holds without a session is no session, whatever the line says", () => {
    expect(reachOf({ line: "connected", presence: false })).toBe("no-session");
    expect(reachOf({ line: "unreachable", presence: false })).toBe("no-session");
  });
});
