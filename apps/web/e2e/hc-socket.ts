import type { Page, WebSocketRoute } from "@playwright/test";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";

/** A gateway on the LAN rather than on this computer: a lost network concerns it. */
export const LAN_HC_URL = `ws://studio.lan:${E2E_HOST_PORT}/v1/hc`;

/** Call before page.goto: carries the page's connections to LAN_HC_URL to the e2e host, as the LAN would. */
export async function routeLanToHost(page: Page): Promise<void> {
  await page.routeWebSocket(LAN_HC_URL, (socket) => {
    const host = new WebSocket(`ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`, ["doriface.v1", `doriface.token.${E2E_TOKEN}`]);
    host.binaryType = "arraybuffer";
    const early: (string | Uint8Array<ArrayBuffer>)[] = [];
    host.addEventListener("open", () => {
      for (const frame of early.splice(0)) host.send(frame);
    });
    socket.onMessage((message) => {
      const frame = typeof message === "string" ? message : Uint8Array.from(message);
      if (host.readyState === WebSocket.OPEN) host.send(frame);
      else early.push(frame);
    });
    host.addEventListener("message", (event: MessageEvent<string | ArrayBuffer>) =>
      socket.send(typeof event.data === "string" ? event.data : Buffer.from(event.data)),
    );
    host.addEventListener(
      "close",
      (event) => void socket.close({ code: event.code === 1000 ? 1000 : 1011, reason: event.reason }),
    );
    socket.onClose(() => host.close());
  });
}

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
  /** Holds the page's requests for these methods (others pass) until the returned release sends them, in order. */
  readonly hold: (...methods: string[]) => () => void;
  /** Every frame the host has delivered to the page, in order, as text. */
  readonly received: () => readonly string[];
  /**
   * Holds hc frames from the host that contain any of these texts (others pass, even from the same message) until the
   * returned release delivers them, in order; holds are independent. Hold a channel's whole stream, not one event in
   * it: the feed drops an event older than one it has seen.
   */
  readonly holdFromHost: (...needles: string[]) => () => void;
}

interface HostHold {
  readonly needles: readonly string[];
  readonly parked: (() => void)[];
}

/** hc's wire frame header: channel (u32), kind (u8), payload length (u32), little-endian. */
const HEADER_BYTES = 9;

/** Splits one WebSocket message into its hc frames; bytes after the last whole frame stay one piece. */
function hcFrames(message: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let offset = 0;
  while (message.byteLength - offset >= HEADER_BYTES) {
    const end = offset + HEADER_BYTES + message.readUInt32LE(offset + 5);
    if (end > message.byteLength) break;
    frames.push(message.subarray(offset, end));
    offset = end;
  }
  if (offset < message.byteLength) frames.push(message.subarray(offset));
  return frames;
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
  let held: readonly string[] = [];
  const parked: (() => void)[] = [];
  const received: string[] = [];
  const hostHolds = new Set<HostHold>();
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
      if (held.some((method) => text.includes(`"method":"${method}"`))) parked.push(() => host.send(frame));
      else host.send(frame);
    });
    host.onMessage((message) => {
      // One message can carry several hc frames (an event and an RPC answer together): each is held or passed alone.
      for (const frame of typeof message === "string" ? [message] : hcFrames(message)) {
        const text = typeof frame === "string" ? frame : frame.toString("latin1");
        const deliver = (): void => {
          received.push(text);
          socket.send(frame);
        };
        const hold = [...hostHolds].find((entry) => entry.needles.some((needle) => text.includes(needle)));
        if (hold !== undefined) {
          hold.parked.push(deliver);
          continue;
        }
        lastDue = Math.max(Date.now() + delay, lastDue);
        setTimeout(deliver, Math.max(0, lastDue - Date.now()));
      }
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
    received: () => received,
    holdFromHost: (...needles) => {
      const hold: HostHold = { needles, parked: [] };
      hostHolds.add(hold);
      return () => {
        hostHolds.delete(hold);
        for (const deliver of hold.parked.splice(0)) deliver();
      };
    },
    hold: (...methods) => {
      held = methods;
      return () => {
        held = [];
        for (const send of parked.splice(0)) send();
      };
    },
  };
}
