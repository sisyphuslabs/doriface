import { createMemoryLinkPair } from "@doriface/client";
import { encodePushLine, parsePushClientLine } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { routeOf } from "./push-route.ts";
import { PushStreamClient } from "./push-stream-client.ts";
import { DEFAULT_SETTINGS } from "../connection/settings.ts";

describe("the push stream client", () => {
  test("matches replies to requests in order, across chunk boundaries", async () => {
    const [mine, host] = createMemoryLinkPair();
    const client = new PushStreamClient(mine);
    const seen: string[] = [];
    host.onData((bytes) => seen.push(parsePushClientLine(new TextDecoder().decode(bytes).trimEnd()).t));
    const first = client.request({ t: "focus", terminal: "t1" });
    const second = client.request({ t: "notice", id: "AAAAAAAAAAAAAAAAAAAAAA" });
    const replies = encodePushLine({ t: "ok" }) + encodePushLine({ t: "notice", terminal: "t1", kind: "done" });
    host.send(new TextEncoder().encode(replies.slice(0, 9)));
    host.send(new TextEncoder().encode(replies.slice(9)));
    expect(await first).toEqual({ t: "ok" });
    expect(await second).toEqual({ t: "notice", terminal: "t1", kind: "done" });
    expect(seen).toEqual(["focus", "notice"]);
  });

  test("a closed stream rejects what still waits", async () => {
    const [mine, host] = createMemoryLinkPair();
    const client = new PushStreamClient(mine);
    const waiting = client.request({ t: "hello" });
    host.close();
    await expect(waiting).rejects.toThrow();
  });
});

describe("the push route", () => {
  test("the loopback client's push stream sits beside its hc stream", () => {
    const route = routeOf({
      ...DEFAULT_SETTINGS,
      mode: "loopback",
      loopbackUrl: "ws://127.0.0.1:7799/v1/hc",
      token: "t",
    });
    expect(route).toEqual({ mode: "loopback", pushUrl: "ws://127.0.0.1:7799/v1/push", token: "t" });
  });
});
