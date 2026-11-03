import { CloseCode, HOST_ID_PATTERN } from "@doriface/relay-client/wire";
import { Hono } from "hono";
import packageJson from "../package.json" with { type: "json" };
import type { Env } from "./env.ts";
import { allowFromIp } from "./limits.ts";
import { closedSocket } from "./reject.ts";

export const RELAY_VERSION = packageJson.version;

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ ok: true, version: RELAY_VERSION }));

app.get("/v1/:role{host|client}/:hostId", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.text("websocket upgrade required", 426);
  const hostId = c.req.param("hostId");
  if (!HOST_ID_PATTERN.test(hostId)) return c.text("hostId must be 26 lowercase base32 characters", 400);
  if (!(await allowFromIp(c.env.CONNECT_LIMIT, c.req.raw))) return closedSocket(CloseCode.RateLimited, "rate limited");
  return c.env.ROOM.get(c.env.ROOM.idFromName(hostId)).fetch(c.req.raw);
});
