import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlIsLive, controlSocketPath, type ControlListener, listenControl } from "./control.ts";

let dir: string;
const listeners: ControlListener[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-ctl-"));
});
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** Sends raw bytes and resolves with everything the host wrote before closing. */
async function exchange(bytes: string): Promise<string> {
  const closed = Promise.withResolvers<string>();
  let text = "";
  const socket = await Bun.connect({
    unix: controlSocketPath(dir),
    socket: {
      data(_, chunk) {
        text += chunk.toString();
      },
      close() {
        closed.resolve(text);
      },
    },
  });
  socket.write(bytes);
  return Promise.race([
    closed.promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the host never answered")), 2000)),
  ]);
}

describe("control socket", () => {
  test("a request longer than the limit without a newline is refused, not buffered", async () => {
    listeners.push(listenControl(dir, () => Promise.resolve("handled")));
    const answer = await exchange("x".repeat(8192));
    expect(JSON.parse(answer)).toEqual({ ok: false, error: "request too large" });
  });

  test("a live socket is reported as live, a stale or missing one is not", async () => {
    expect(await controlIsLive(dir)).toBe(false);
    const listener = listenControl(dir, () => Promise.resolve(undefined));
    try {
      expect(await controlIsLive(dir)).toBe(true);
    } finally {
      listener.stop();
    }
    expect(await controlIsLive(dir)).toBe(false);
  });

  test("a request's signal aborts once the connection that sent it closes", async () => {
    const asked = Promise.withResolvers<AbortSignal>();
    listeners.push(
      listenControl(dir, (_, closed) => {
        asked.resolve(closed);
        return new Promise(() => {});
      }),
    );
    const socket = await Bun.connect({ unix: controlSocketPath(dir), socket: { data() {} } });
    socket.write('{"op":"mesh-pending"}\n');
    const closed = await asked.promise;
    const aborted = new Promise<unknown>((resolve) => closed.addEventListener("abort", () => resolve(closed.reason)));
    socket.end();
    expect(String(await aborted)).toContain("the control connection closed");
  });
});
