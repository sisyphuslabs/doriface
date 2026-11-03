import { afterEach, describe, expect, test } from "bun:test";
import { openWebSocketLink } from "./ws-link.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function serve(onText: (text: string) => void): string {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request, srv) => (srv.upgrade(request) ? undefined : new Response("ws only", { status: 426 })),
    websocket: {
      message: (_socket, message) => {
        if (typeof message === "string") onText(message);
      },
    },
  });
  servers.push(server);
  return `ws://127.0.0.1:${server.port}/`;
}

describe("openWebSocketLink keepalive", () => {
  test("sends the text message ping at the interval and stops on close", async () => {
    const firstPing = Promise.withResolvers<string>();
    const url = serve((text) => firstPing.resolve(text));
    const link = await openWebSocketLink(url, [], { pingEveryMs: 10 });
    expect(await firstPing.promise).toBe("ping");
    link.close();
  });

  test("sends no ping by default", async () => {
    let pings = 0;
    const url = serve(() => pings++);
    const link = await openWebSocketLink(url, []);
    const closed = new Promise<void>((resolve) => link.onClose(() => resolve()));
    link.close();
    await closed;
    expect(pings).toBe(0);
  });
});
