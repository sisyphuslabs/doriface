import type { WebSocketHandler } from "bun";
import { Hono } from "hono";
import { type BunWebSocketData, upgradeWebSocket } from "hono/bun";
import type { WSEvents } from "hono/ws";
import { checkHandshake } from "./auth.ts";
import { bridge } from "./bridge.ts";
import type { Link } from "./link.ts";
import { WsLink } from "./ws-link.ts";

/** A link backed by a child process; `exited` settles once the child is gone. */
export type ChildLink = Link & { readonly exited: Promise<unknown> };

export interface GatewayOptions {
  readonly token: string;
  readonly hostVersion: string;
  readonly hcVersion: string;
  readonly openPipe: () => ChildLink;
  readonly log: (line: string) => void;
}

export interface Gateway {
  readonly app: Hono;
  readonly websocket: WebSocketHandler<BunWebSocketData>;
  /** Closes every client socket and resolves once every `hc connect` child has exited. */
  closeAll(): Promise<void>;
}

export function createGateway(options: GatewayOptions): Gateway {
  const links = new WeakMap<WSEvents, WsLink<BunWebSocketData>>();
  const sockets = new Set<WsLink<BunWebSocketData>>();
  const children = new Set<Promise<unknown>>();
  const { log } = options;

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true, hostVersion: options.hostVersion, hcVersion: options.hcVersion }));
  app.get(
    "/v1/hc",
    async (c, next) => {
      if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.text("websocket upgrade required", 426);
      const verdict = checkHandshake(c.req.header("sec-websocket-protocol"), options.token);
      if (!verdict.ok) return c.text(verdict.reason, verdict.status);
      await next();
      return undefined;
    },
    // A fresh events object per upgrade identifies the connection in the Bun handler below.
    upgradeWebSocket(() => ({})),
  );

  const websocket: WebSocketHandler<BunWebSocketData> = {
    perMessageDeflate: false,
    open(ws) {
      const link = new WsLink(ws);
      links.set(ws.data.events, link);
      sockets.add(link);
      link.onClose(() => sockets.delete(link));
      let pipe: ChildLink;
      try {
        pipe = options.openPipe();
      } catch (error) {
        log(`cannot start hc connect: ${String(error)}`);
        link.close(1011, "hc connect failed to start");
        return;
      }
      const exited = pipe.exited.finally(() => children.delete(exited));
      children.add(exited);
      void bridge(link, pipe, (error) => log(`connection closed: ${String(error)}`));
    },
    message(ws, message) {
      links.get(ws.data.events)?.receive(message);
    },
    drain(ws) {
      links.get(ws.data.events)?.drained();
    },
    close(ws) {
      links.get(ws.data.events)?.peerClosed();
    },
  };

  const closeAll = async (): Promise<void> => {
    for (const link of sockets) link.close(1001, "host shutting down");
    await Promise.all(children);
  };

  return { app, websocket, closeAll };
}
