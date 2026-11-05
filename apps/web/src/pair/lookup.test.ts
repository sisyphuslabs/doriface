import { afterEach, expect, test } from "bun:test";
import { generateHostIdentity, generateX25519 } from "@doriface/crypto";
import { toBase64Url } from "@doriface/relay-client/wire";
import { lookupCode } from "./lookup.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The relay answers the lookup with this body, as `GET /v1/pair/<slot>` does. */
function relayAnswers(body: unknown): void {
  globalThis.fetch = Object.assign(async () => Response.json(body), { preconnect: realFetch.preconnect });
}

test("a relay answer with the host's real hostId and signPub but an attacker's noiseStaticPub is refused (#22)", async () => {
  const host = generateHostIdentity();
  const attacker = generateX25519();
  relayAnswers({
    hostId: host.hostId,
    signPub: toBase64Url(host.sign.publicKey),
    noiseStaticPub: toBase64Url(attacker.publicKey),
  });
  const parsed = await lookupCode("AB3K9XQZ", "wss://relay.example");
  expect(parsed.ok).toBe(false);
});
