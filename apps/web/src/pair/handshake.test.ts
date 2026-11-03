import { expect, test } from "bun:test";
import { pairingFailureReason } from "./handshake.ts";

test.each([
  ["code", 4400, "The code doesn't match this host. Check it and try again."],
  ["code", 4410, "No host is pairing with this code. It may have expired."],
  ["code", 4429, "Too many attempts for this code. Use the QR code or run doriface-host pair again."],
  ["link", 4400, "This pairing link doesn't match this host. Run doriface-host pair again."],
] as const)("a %s pairing closed with %i reads: %s", (mode, code, reason) => {
  expect(pairingFailureReason(mode, code)).toBe(reason);
});

test("a close code with no pairing meaning keeps the original error", () => {
  expect(pairingFailureReason("code", 1006)).toBeUndefined();
  expect(pairingFailureReason("link", undefined)).toBeUndefined();
});
