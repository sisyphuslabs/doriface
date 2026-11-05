import { describe, expect, test } from "bun:test";
import { hostFailure } from "./host-failure.ts";
import { LoopbackAddressError } from "./loopback-address.ts";
import { LinkCloseError } from "./ws-link.ts";

describe("why the host cannot be reached, in plain words (#477)", () => {
  test("a link that closed abnormally (1006) reads as a sentence with a next step, never as its code", () => {
    const words = hostFailure(new LinkCloseError(1006, ""));
    expect(words).toBe("Your host isn't answering. Check that its computer is on and doriface-host is running.");
    expect(words).not.toContain("1006");
  });

  test("a refused loopback address keeps its own sentence (#462)", () => {
    const refusal = new LoopbackAddressError("The loopback address must be on this computer.");
    expect(hostFailure(refusal)).toBe(refusal.message);
  });
});
