import { afterEach, describe, expect, test } from "bun:test";
import { devicesEndpointUrl, requestPairedDevices, revokePairedDevice } from "../src/main/devices.ts";
import type { LocalHostEndpoint } from "../src/shared/bridge.ts";

const token = "t".repeat(43);
const endpoint = (port: number): LocalHostEndpoint => ({ url: `ws://127.0.0.1:${port}/v1/hc`, token });

const PHONE = { name: "phone", id: "3FA94C0E", pairedAt: "2026-11-06T07:00:00.000Z" } as const;
const LAPTOP = { name: "laptop", id: "AB12CD34", pairedAt: "2026-11-06T08:00:00.000Z" } as const;

interface Stub {
  readonly server: ReturnType<typeof Bun.serve>;
  readonly seen: { method: string; path: string; authorization: string | null }[];
}

const stubs: Stub[] = [];
afterEach(() => {
  for (const stub of stubs.splice(0)) void stub.server.stop(true);
});

function hostAnswers(answer: (request: Request) => Response): Stub {
  const seen: Stub["seen"] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
      });
      return answer(request);
    },
  });
  const stub = { server, seen };
  stubs.push(stub);
  return stub;
}

describe("this computer's paired devices over the loopback gateway", () => {
  test("the websocket endpoint names the plain-HTTP device routes", () => {
    expect(devicesEndpointUrl({ url: "ws://127.0.0.1:52011/v1/hc", token })).toBe("http://127.0.0.1:52011/v1/devices");
    expect(devicesEndpointUrl({ url: "wss://host.example/v1/hc", token }, PHONE.id)).toBe(
      "https://host.example/v1/devices/3FA94C0E",
    );
    expect(devicesEndpointUrl({ url: "ws://127.0.0.1:1/v1/hc", token }, "a/../b")).toBe(
      "http://127.0.0.1:1/v1/devices/a%2F..%2Fb",
    );
  });

  test("the list is read with the host's per-launch token, and a device is revoked by its short id", async () => {
    let paired: readonly (typeof PHONE | typeof LAPTOP)[] = [PHONE, LAPTOP];
    const stub = hostAnswers((request) => {
      if (request.method !== "DELETE") return Response.json({ devices: paired });
      paired = paired.filter((device) => device.id !== PHONE.id);
      return Response.json({ revoked: [PHONE] });
    });
    const port = stub.server.port ?? 0;
    const listed = await requestPairedDevices(endpoint(port));
    expect(listed).toEqual({ state: "listed", devices: [PHONE, LAPTOP] });
    const revoked = await revokePairedDevice(endpoint(port), PHONE.id);
    expect(revoked).toEqual({ state: "revoked", device: PHONE, devices: [LAPTOP] });
    expect(stub.seen.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "GET /v1/devices",
      "DELETE /v1/devices/3FA94C0E",
      "GET /v1/devices",
    ]);
    expect(stub.seen.every((entry) => entry.authorization === `Bearer ${token}`)).toBe(true);
  });

  test("a host whose launch token changed is unavailable, not an empty list", async () => {
    const stub = hostAnswers(() => new Response("missing or wrong doriface token", { status: 401 }));
    expect(await requestPairedDevices(endpoint(stub.server.port ?? 0))).toEqual({
      state: "unavailable",
      reason: "This computer's host refused the request; start it again.",
    });
  });

  test("a revoke the host does not know answers the list it read again, as not-found", async () => {
    const stub = hostAnswers((request) =>
      request.method === "DELETE" ? new Response("nope", { status: 404 }) : Response.json({ devices: [LAPTOP] }),
    );
    expect(await revokePairedDevice(endpoint(stub.server.port ?? 0), PHONE.id)).toEqual({
      state: "not-found",
      devices: [LAPTOP],
    });
  });

  test("an answer this app does not understand is named, never half-read", async () => {
    const stub = hostAnswers(() => Response.json({ devices: [{ name: "phone" }] }));
    expect(await requestPairedDevices(endpoint(stub.server.port ?? 0))).toEqual({
      state: "unavailable",
      reason: "This computer's host sent a device list this app does not understand.",
    });
  });
});
