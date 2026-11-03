import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createHcSession, type HcSession } from "../../host/src/testing/hc-session.ts";
import { LocalHost } from "../src/main/local-host.ts";

const cli = join(import.meta.dir, "..", "..", "host", "src", "cli.ts");
const logs: string[] = [];
let session: HcSession;
let host: LocalHost;

const openSocket = (url: string, protocols: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocols);
    socket.addEventListener("open", () => {
      resolve(socket.protocol);
      socket.close();
    });
    socket.addEventListener("error", () => reject(new Error("refused")));
  });

beforeAll(() => {
  session = createHcSession("doriface-desktop-test");
  host = new LocalHost({
    command: { file: process.execPath, args: [cli] },
    hc: session.hc,
    env: session.env,
    log: (line) => logs.push(line),
  });
});

afterAll(async () => {
  await host.stop();
  await session.dispose();
});

describe("LocalHost against the workspace doriface-host and a real hc", () => {
  test("starts once on an ephemeral loopback port and admits only its token", async () => {
    const endpoint = await host.start();
    expect(endpoint.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/v1\/hc$/);
    expect(endpoint.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await host.start()).toBe(endpoint);

    const health = await fetch(endpoint.url.replace(/^ws:/, "http:").replace(/\/v1\/hc$/, "/healthz"));
    expect(health.status).toBe(200);
    expect(await openSocket(endpoint.url, ["doriface.v1", `doriface.token.${endpoint.token}`])).toBe("doriface.v1");
    await expect(
      openSocket(endpoint.url, ["doriface.v1", "doriface.token.wrong-token-wrong-token-xx"]),
    ).rejects.toThrow("refused");
  });

  test("a stopped host starts again on a fresh token", async () => {
    const first = await host.start();
    await host.stop();
    const second = await host.start();
    expect(second.token).not.toBe(first.token);
    expect(logs.some((line) => line.startsWith("doriface-host exited"))).toBe(true);
  });

  test("a start issued while a stopped child is still exiting keeps its own in-flight spawn", async () => {
    await host.stop();
    const abandoned = host.start();
    const stopped = host.stop();
    const restarted = host.start();
    await expect(abandoned).rejects.toThrow("exited before listening");
    await stopped;
    expect(host.start()).toBe(restarted);
    expect((await restarted).url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/v1\/hc$/);
  });

  test("a host that dies before listening rejects with its stderr, and the next start retries", async () => {
    const broken = new LocalHost({
      command: { file: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"] },
      hc: undefined,
      env: process.env,
      log: () => {},
    });
    await expect(broken.start()).rejects.toThrow(/exited before listening \(code 3\):\nboom/);
    await expect(broken.start()).rejects.toThrow("exited before listening");
  });
});
