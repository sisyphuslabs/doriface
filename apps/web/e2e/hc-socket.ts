import type { Page, WebSocketRoute } from "@playwright/test";
import { E2E_HOST_PORT } from "./config.ts";

/** The page's hc WebSocket, routed through the spec so it can lag like the relay and drop like a relay blip. */
export interface HcSocket {
  readonly opened: () => number;
  /** Reconnects refused while down: one or more means the page has noticed the drop. */
  readonly refused: () => number;
  /** Every frame the page has sent, in order, as text (the RPC JSON inside a frame reads as latin1). */
  readonly sent: () => readonly string[];
  /** Holds every later frame from the host `ms`, in order, as a relay round trip does. */
  readonly delay: (ms: number) => void;
  /** Closes every open connection; while `down` is true the page's reconnects are refused. */
  readonly drop: (down: boolean) => Promise<void>;
  readonly restore: () => void;
  /** Holds the page's requests for `method` (others pass) until the returned release sends them, in order. */
  readonly hold: (method: string) => () => void;
}

/** Call before page.goto: every connection to the e2e host passes through the returned handle. */
export async function routeHcSocket(page: Page): Promise<HcSocket> {
  const live = new Set<WebSocketRoute>();
  const sent: string[] = [];
  let down = false;
  let opened = 0;
  let refused = 0;
  let delay = 0;
  let lastDue = 0;
  let held: string | null = null;
  const parked: (() => void)[] = [];
  await page.routeWebSocket(`ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`, (socket) => {
    if (down) {
      refused += 1;
      void socket.close({ code: 1011, reason: "host unreachable" });
      return;
    }
    const host = socket.connectToServer();
    socket.onMessage((frame) => {
      const text = typeof frame === "string" ? frame : frame.toString("latin1");
      sent.push(text);
      if (held !== null && text.includes(`"method":"${held}"`)) parked.push(() => host.send(frame));
      else host.send(frame);
    });
    host.onMessage((frame) => {
      lastDue = Math.max(Date.now() + delay, lastDue);
      setTimeout(() => socket.send(frame), Math.max(0, lastDue - Date.now()));
    });
    live.add(socket);
    opened += 1;
  });
  return {
    opened: () => opened,
    refused: () => refused,
    sent: () => sent,
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
    hold: (method) => {
      held = method;
      return () => {
        held = null;
        for (const send of parked.splice(0)) send();
      };
    },
  };
}
