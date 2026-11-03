import type { Page, WebSocketRoute } from "@playwright/test";
import { E2E_HOST_PORT } from "./config.ts";

/** The page's hc WebSocket, routed through the spec so it can lag like the relay and drop like a relay blip. */
export interface HcSocket {
  readonly opened: () => number;
  /** Holds every later frame from the host `ms`, in order, as a relay round trip does. */
  readonly delay: (ms: number) => void;
  /** Closes every open connection; while `down` is true the page's reconnects are refused. */
  readonly drop: (down: boolean) => Promise<void>;
  readonly restore: () => void;
}

/** Call before page.goto: every connection to the e2e host passes through the returned handle. */
export async function routeHcSocket(page: Page): Promise<HcSocket> {
  const live = new Set<WebSocketRoute>();
  let down = false;
  let opened = 0;
  let delay = 0;
  let lastDue = 0;
  await page.routeWebSocket(`ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`, (socket) => {
    if (down) {
      void socket.close({ code: 1011, reason: "host unreachable" });
      return;
    }
    const host = socket.connectToServer();
    socket.onMessage((frame) => host.send(frame));
    host.onMessage((frame) => {
      lastDue = Math.max(Date.now() + delay, lastDue);
      setTimeout(() => socket.send(frame), Math.max(0, lastDue - Date.now()));
    });
    live.add(socket);
    opened += 1;
  });
  return {
    opened: () => opened,
    delay: (ms) => void (delay = ms),
    drop: async (stayDown) => {
      down = stayDown;
      const closing = [...live].map((socket) => socket.close({ code: 1011, reason: "relay blip" }));
      live.clear();
      await Promise.all(closing);
    },
    restore: () => {
      down = false;
    },
  };
}
