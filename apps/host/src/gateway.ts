import type { WebSocketHandler } from "bun";
import { Hono } from "hono";
import { type BunWebSocketData, upgradeWebSocket } from "hono/bun";
import type { WSEvents } from "hono/ws";
import { checkHandshake } from "./auth.ts";
import { bridge } from "./bridge.ts";
import { acceptE2ee, type E2eeDeps } from "./e2ee/accept.ts";
import { plaintextLink, WsByteLink } from "./e2ee/links.ts";
import type { LiveSessions } from "./e2ee/sessions.ts";
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
  /** Enables `/v1/e2ee`: the Noise record layer in front of the same `hc connect` pipe. */
  readonly e2ee?: (E2eeDeps & { readonly sessions: LiveSessions }) | undefined;
}

export interface Gateway {
  /** Every route: healthz, the loopback-only plaintext `/v1/hc`, and `/v1/e2ee` when enabled. */
  readonly app: Hono;
  /** For a non-loopback listener: healthz and `/v1/e2ee` only, since every byte there is authenticated. */
  readonly lanApp: Hono;
  readonly websocket: WebSocketHandler<BunWebSocketData>;
  /** Closes every client socket and resolves once every `hc connect` child has exited. */
  closeAll(): Promise<void>;
}

export function createGateway(options: GatewayOptions): Gateway {
  const links = new WeakMap<WSEvents, WsLink<BunWebSocketData>>();
  const sockets = new Set<WsLink<BunWebSocketData>>();
  const children = new Set<Promise<unknown>>();
  const e2eeEvents = new WeakSet<WSEvents>();
  const { log, e2ee } = options;

  const app = new Hono();
  const lanApp = new Hono();
  for (const target of [app, lanApp]) {
    target.get("/healthz", (c) => c.json({ ok: true, hostVersion: options.hostVersion, hcVersion: options.hcVersion }));
    if (e2ee === undefined) continue;
    target.get(
      "/v1/e2ee",
      async (c, next) => {
        if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.text("websocket upgrade required", 426);
        await next();
        return undefined;
      },
      upgradeWebSocket(() => {
        const events: WSEvents = {};
        e2eeEvents.add(events);
        return events;
      }),
    );
  }
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

  const pipeTo = (link: Link, closeClient: (code: number, reason: string) => void): void => {
    let pipe: ChildLink;
    try {
      pipe = options.openPipe();
    } catch (error) {
      log(`cannot start hc connect: ${String(error)}`);
      closeClient(1011, "hc connect failed to start");
      return;
    }
    const exited = pipe.exited.finally(() => children.delete(exited));
    children.add(exited);
    void bridge(link, pipe, (error) => log(`connection closed: ${String(error)}`));
  };

  const openE2ee = async (link: WsLink<BunWebSocketData>, deps: NonNullable<GatewayOptions["e2ee"]>): Promise<void> => {
    const wire = new WsByteLink(link);
    const secure = await acceptE2ee(wire, deps);
    if (secure === undefined) return;
    deps.sessions.add(secure);
    pipeTo(
      plaintextLink(secure, () => wire.flushed()),
      (code, reason) => secure.close(code, reason),
    );
  };

  const websocket: WebSocketHandler<BunWebSocketData> = {
    perMessageDeflate: false,
    open(ws) {
      const link = new WsLink(ws);
      links.set(ws.data.events, link);
      sockets.add(link);
      link.onClose(() => sockets.delete(link));
      if (e2ee !== undefined && e2eeEvents.has(ws.data.events)) {
        openE2ee(link, e2ee).catch((error: unknown) => {
          log(`e2ee session failed: ${String(error)}`);
          link.close(1011, "internal error");
        });
        return;
      }
      pipeTo(link, (code, reason) => link.close(code, reason));
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

  return { app, lanApp, websocket, closeAll };
}
