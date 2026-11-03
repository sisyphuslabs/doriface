import { CloseCode, HOST_ID_PATTERN, PAIR_SLOT_PATTERN } from "@doriface/relay-client/wire";
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

app.get("/v1/pair/:slot", async (c) => {
  const slot = c.req.param("slot");
  if (!PAIR_SLOT_PATTERN.test(slot)) return c.json({ error: "slot must be 3 Crockford base32 characters" }, 400);
  if (!(await allowFromIp(c.env.PAIR_LIMIT, c.req.raw))) return c.json({ error: "rate limited" }, 429);
  const record = await c.env.PAIR_SLOTS.get(c.env.PAIR_SLOTS.idFromName(slot)).lookup();
  return record === null ? c.json({ error: "no host is pairing on this slot" }, 404) : c.json(record);
});
