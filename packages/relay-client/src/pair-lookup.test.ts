import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  lookupPairSlot,
  PAIR_OFFER_TTL_MS,
  PAIR_SLOT_CLOCK_ALLOWANCE_MS,
  PairLookupError,
  pairSlotRefusal,
  UNSIGNED_SLOT_REASON,
} from "./pair-lookup.ts";
import { hostIdOf, pairSlotStatement, toBase64Url } from "./wire/index.ts";

interface Call {
  readonly url: string;
  readonly signal: AbortSignal | undefined;
}

type Fetch = (url: string, init?: { readonly signal?: AbortSignal }) => Promise<Response>;

function recordingFetch(response: () => Response): { calls: Call[]; fetch: Fetch } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, signal: init?.signal });
      return response();
    },
  };
}

describe("lookupPairSlot", () => {
  test("a 200 whose body is not JSON is a malformed answer (502)", async () => {
    const { fetch } = recordingFetch(() => new Response("<html>", { status: 200 }));
    const lookup = lookupPairSlot({ relayUrl: "https://relay.example", code: "AB3K9XQZ", fetch });
    await expect(lookup).rejects.toMatchObject({ name: "PairLookupError", status: 502 });
    await expect(lookup).rejects.toBeInstanceOf(PairLookupError);
  });

  test("a ws(s) relay URL is looked up over http(s)", async () => {
    const { calls, fetch } = recordingFetch(() => new Response("{}", { status: 404 }));
    await lookupPairSlot({ relayUrl: "wss://relay.example", code: "AB3K9XQZ", fetch });
    await lookupPairSlot({ relayUrl: "ws://127.0.0.1:8787", code: "AB3K9XQZ", fetch });
    expect(calls.map(({ url }) => url)).toEqual([
      "https://relay.example/v1/pair/AB3",
      "http://127.0.0.1:8787/v1/pair/AB3",
    ]);
  });

  test("the caller's abort signal reaches the request", async () => {
    const { calls, fetch } = recordingFetch(() => new Response("{}", { status: 404 }));
    const controller = new AbortController();
    await lookupPairSlot({ relayUrl: "https://relay.example", code: "AB3K9XQZ", fetch, signal: controller.signal });
    expect(calls[0]?.signal).toBe(controller.signal);
  });
});

const NOW = 1_793_800_000_000;
const SLOT = "AB3";

/** A host's keys and a signed answer for SLOT, as a v1.9 relay returns it; `extra` overrides any field. */
async function signedAnswer(
  extra: Record<string, unknown> = {},
  sign: { slot?: string; expiresAt?: number } = {},
): Promise<{ body: Record<string, unknown>; noise: Uint8Array; secret: Uint8Array }> {
  const secret = ed25519.utils.randomSecretKey();
  const signPub = ed25519.getPublicKey(secret);
  const noise = crypto.getRandomValues(new Uint8Array(32));
  const expiresAt = sign.expiresAt ?? NOW + 5 * 60 * 1000;
  const slotSig = ed25519.sign(pairSlotStatement(sign.slot ?? SLOT, noise, expiresAt), secret);
  const body = {
    hostId: await hostIdOf(signPub),
    signPub: toBase64Url(signPub),
    noiseStaticPub: toBase64Url(noise),
    expiresAt,
    slotSig: toBase64Url(slotSig),
    ...extra,
  };
  return { body, noise, secret };
}

const look = (body: unknown, now = NOW) =>
  lookupPairSlot({
    relayUrl: "https://relay.example",
    code: "AB3K9XQZ",
    fetch: async () => Response.json(body),
    now: () => now,
  });

describe("lookupPairSlot: the host's signature over its slot (#22, contract v1.9)", () => {
  test("a signed answer carries its expiry and signature through", async () => {
    const { body, noise } = await signedAnswer();
    const record = await look(body);
    expect(record?.noiseStaticPub).toEqual(noise);
    expect(record?.expiresAt).toBe(body["expiresAt"] as number);
    expect(record?.slotSig?.byteLength).toBe(64);
  });

  test("an unsigned answer, from an old host or an old relay, is refused with the reason naming both", async () => {
    const { body } = await signedAnswer();
    const { expiresAt: _expiresAt, slotSig: _slotSig, ...unsigned } = body;
    await expect(look(unsigned)).rejects.toMatchObject({ status: 502, message: UNSIGNED_SLOT_REASON });
  });

  test("the relay swapping in another Noise key under the host's valid signature is refused", async () => {
    const { body } = await signedAnswer();
    const swapped = { ...body, noiseStaticPub: toBase64Url(crypto.getRandomValues(new Uint8Array(32))) };
    await expect(look(swapped)).rejects.toMatchObject({ status: 502, message: pairSlotRefusal("bad-signature") });
  });

  test("a signature for another slot, another expiry or by another key is refused", async () => {
    const forOtherSlot = await signedAnswer({}, { slot: "AB4" });
    await expect(look(forOtherSlot.body)).rejects.toMatchObject({ message: pairSlotRefusal("bad-signature") });
    const moved = await signedAnswer();
    await expect(look({ ...moved.body, expiresAt: (moved.body["expiresAt"] as number) + 1 })).rejects.toMatchObject({
      message: pairSlotRefusal("bad-signature"),
    });
    const other = await signedAnswer();
    await expect(look({ ...moved.body, slotSig: other.body["slotSig"] })).rejects.toMatchObject({
      message: pairSlotRefusal("bad-signature"),
    });
  });

  test("the expiry may be up to 10 minutes past and up to one offer TTL plus 10 minutes ahead, by the client's clock", async () => {
    const allowance = PAIR_SLOT_CLOCK_ALLOWANCE_MS;
    const ahead = PAIR_OFFER_TTL_MS + allowance;
    for (const [offset, verdict] of [
      [-allowance, "signed"],
      [-allowance - 1, "expired"],
      [ahead, "signed"],
      [ahead + 1, "too-far-ahead"],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one signed answer at a time
      const { body } = await signedAnswer({}, { expiresAt: NOW + offset });
      const outcome = look(body).then(
        () => "signed",
        (error: unknown) => (error instanceof PairLookupError ? error.message : String(error)),
      );
      // oxlint-disable-next-line no-await-in-loop -- one signed answer at a time
      expect(await outcome).toBe(verdict === "signed" ? "signed" : pairSlotRefusal(verdict));
    }
  });

  test("one field without the other, a short signature or an unsafe expiry is a malformed answer", async () => {
    const { body } = await signedAnswer();
    const sig = body["slotSig"];
    for (const extra of [
      { slotSig: undefined },
      { expiresAt: undefined },
      { slotSig: toBase64Url(new Uint8Array(63)) },
      { expiresAt: Number.MAX_SAFE_INTEGER + 2, slotSig: sig },
      { expiresAt: "1" },
      { expiresAt: -1 },
      { expiresAt: null },
      { slotSig: "not base64url!" },
      { slotSig: null },
    ]) {
      const shaped = Object.fromEntries(
        Object.entries({ ...body, ...extra }).filter(([, value]) => value !== undefined),
      );
      // oxlint-disable-next-line no-await-in-loop -- one answer at a time, each its own lookup
      await expect(look(shaped)).rejects.toMatchObject({
        name: "PairLookupError",
        message: "the relay's pairing answer is malformed",
      });
    }
  });
});

/** A host's real signing key and Noise key, and an attacker's Noise key: what a lying relay can mix (#22). */
async function hostAndAttacker(): Promise<{
  hostId: string;
  signPub: Uint8Array;
  noise: Uint8Array;
  attacker: Uint8Array;
}> {
  const keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signPub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return {
    hostId: await hostIdOf(signPub),
    signPub,
    noise: crypto.getRandomValues(new Uint8Array(32)),
    attacker: crypto.getRandomValues(new Uint8Array(32)),
  };
}

describe("lookupPairSlot: a relay that swaps in another Noise static key (#22)", () => {
  test("an answer with the host's real hostId and signPub but an attacker's noiseStaticPub is refused", async () => {
    const host = await hostAndAttacker();
    const lying = {
      hostId: host.hostId,
      signPub: toBase64Url(host.signPub),
      noiseStaticPub: toBase64Url(host.attacker),
    };
    const { fetch } = recordingFetch(() => Response.json(lying));
    const lookup = lookupPairSlot({ relayUrl: "https://relay.example", code: "AB3K9XQZ", fetch });
    await expect(lookup).rejects.toBeInstanceOf(PairLookupError);
  });
});
