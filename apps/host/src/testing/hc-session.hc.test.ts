import { expect, test } from "bun:test";
import { createHcSession, stopLeftoverCores } from "./hc-session.ts";

const line = (method: string): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method })}\n`);

test("the guard's sweep reports a core started again after dispose, and stops it", async () => {
  const session = createHcSession("guard");
  const socket = session.env["HC_SOCKET"];
  if (socket === undefined) throw new Error("no HC_SOCKET");
  await session.dispose();
  // hc connect starts the stopped core again, as a dialer's reconnect does.
  const again = session.connect();
  await again.write(line("server.status"));
  await again.reader.line();
  again.end();
  await again.exited;
  // Held across the sweep: only the core itself, stopping, closes it. The sweep removes the socket's dir, so a fresh
  // connect afterwards would be refused whether or not the core still runs.
  const closed = Promise.withResolvers<void>();
  let open = true;
  const held = await Bun.connect({
    unix: socket,
    socket: {
      data: () => {},
      end: (s) => {
        s.end();
      },
      close: () => {
        open = false;
        closed.resolve();
      },
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stillRunning = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the core never closed the held connection: it still runs")), 10_000);
  });
  try {
    expect(await stopLeftoverCores()).toEqual([session.name]);
    await Promise.race([closed.promise, stillRunning]);
    expect(await stopLeftoverCores()).toEqual([]);
  } finally {
    clearTimeout(timer);
    if (open) {
      held.write(line("server.stop"));
      await closed.promise;
    }
  }
}, 30_000);
