import { expect, test } from "bun:test";
import { PairingFailedError, pairingFailureReason, pairWithHost } from "./handshake.ts";

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

test("a link pairing the relay rate-limits reads as person-facing copy", () => {
  expect(pairingFailureReason("link", 4429)).toBe(
    "Too many attempts from this network. Wait a few minutes and try again.",
  );
});

test("a relay that cannot be reached fails pairing with person-facing copy, not the raw error", async () => {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  const offer = {
    hostId: "a".repeat(26),
    noiseStaticPub: new Uint8Array(32),
    signPub: new Uint8Array(32),
    secret: { mode: "link", linkSecret: new Uint8Array(32) },
    relayUrl: `http://127.0.0.1:${port}`,
    fingerprint: "",
  } as const;
  const failure = await pairWithHost(offer, "phone").then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure instanceof PairingFailedError && failure.message).toBe(
    "The relay cannot be reached. Check the network and try again.",
  );
});
