import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "./auth.ts";
import { type Host, startHost } from "./host.ts";
import { resolveHcBin } from "./testing/hc-session.ts";

const IDLE_MS = 300;
const stateDir = mkdtempSync(join(tmpdir(), "dh-keepalive-"));
let host: Host;

beforeAll(async () => {
  host = await startHost({
    listen: { hostname: "127.0.0.1", port: 0 },
    token: generateToken(),
    hc: resolveHcBin(),
    stateDir,
    directIdleMs: IDLE_MS,
    log: () => {},
  });
});

afterAll(async () => {
  await host.stop();
  rmSync(stateDir, { recursive: true, force: true });
});

function e2eeUrl(): string {
  const url = host.e2ee?.url;
  if (url === undefined) throw new Error("no e2ee endpoint");
  return url;
}

/** Opens a raw /v1/e2ee socket and records its text messages and close code. */
async function open() {
  const socket = new WebSocket(e2eeUrl());
  const texts: string[] = [];
  const closed = Promise.withResolvers<number>();
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") texts.push(event.data);
  });
  socket.addEventListener("close", (event) => closed.resolve(event.code));
  const opened = Promise.withResolvers<void>();
  socket.addEventListener("open", () => opened.resolve());
  await opened.promise;
  return { socket, texts, closed: closed.promise };
}

describe("direct-path keepalive on /v1/e2ee", () => {
  test("a text ping is answered with a text pong", async () => {
    const client = await open();
    const pong = Promise.withResolvers<void>();
    client.socket.addEventListener("message", (event) => {
      if (event.data === "pong") pong.resolve();
    });
    client.socket.send("ping");
    await pong.promise;
    expect(client.texts).toEqual(["pong"]);
    client.socket.close(1000);
    expect(await client.closed).toBe(1000);
  });

  test("a socket that receives nothing is closed with 4408", async () => {
    const client = await open();
    expect(await client.closed).toBe(4408);
  });

  test("any other text message is refused with 1003", async () => {
    const client = await open();
    client.socket.send("hello");
    expect(await client.closed).toBe(1003);
  });
});
