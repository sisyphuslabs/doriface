import { describe, expect, test } from "bun:test";
import { lookupPairSlot, PairLookupError } from "./pair-lookup.ts";

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
