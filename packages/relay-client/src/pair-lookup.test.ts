import { describe, expect, test } from "bun:test";
import { lookupPairSlot, PairLookupError } from "./pair-lookup.ts";
import { hostIdOf, toBase64Url } from "./wire/index.ts";

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

async function answer(extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signPub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return {
    hostId: await hostIdOf(signPub),
    signPub: toBase64Url(signPub),
    noiseStaticPub: toBase64Url(new Uint8Array(32).fill(7)),
    ...extra,
  };
}
const look = (body: unknown) =>
  lookupPairSlot({ relayUrl: "https://relay.example", code: "AB3K9XQZ", fetch: async () => Response.json(body) });

describe("lookupPairSlot: the signed form's optional fields (#22)", () => {
  test("an answer without them reads as before", async () => {
    const record = await look(await answer({}));
    expect(record?.expiresAt).toBeUndefined();
    expect(record?.slotSig).toBeUndefined();
  });

  test("an answer with both carries them", async () => {
    const slotSig = new Uint8Array(64).fill(9);
    const record = await look(await answer({ expiresAt: 1_793_800_000_000, slotSig: toBase64Url(slotSig) }));
    expect(record?.expiresAt).toBe(1_793_800_000_000);
    expect(record?.slotSig).toEqual(slotSig);
  });

  test("one without the other, a short signature or an unsafe expiry is a malformed answer (502)", async () => {
    const sig = toBase64Url(new Uint8Array(64));
    for (const extra of [
      { expiresAt: 1 },
      { slotSig: sig },
      { expiresAt: 1, slotSig: toBase64Url(new Uint8Array(63)) },
      { expiresAt: Number.MAX_SAFE_INTEGER + 2, slotSig: sig },
      { expiresAt: "1", slotSig: sig },
      { expiresAt: -1, slotSig: sig },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one answer at a time, each its own lookup
      await expect(look(await answer(extra))).rejects.toMatchObject({ name: "PairLookupError", status: 502 });
    }
  });
});
