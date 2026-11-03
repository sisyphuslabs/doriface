# @doriface/relay

The Cloudflare Workers + Durable Objects relay that carries doriface traffic when a client cannot reach its host
directly. It implements the relay part of the transport contract:

- `GET /healthz` answers `{"ok": true, "version": "..."}`.
- `GET /v1/host/<hostId>` (WebSocket) is the host uplink. The relay sends a 32-byte challenge; the host answers
  `signPub || Ed25519 signature` over `"doriface-relay-v1" || hostId || challenge`. A wrong key or signature closes
  with 4403, and a newer authenticated uplink replaces the old one (closed with 4409, its sessions with 4404).
- `GET /v1/client/<hostId>` (WebSocket) opens a client session. Each session is multiplexed onto the uplink as
  `[type u8][sessionId u32 LE][payload]` frames (1 OPEN, 2 DATA, 3 CLOSE). An offline host closes the
  client with 4404; the 33rd concurrent session to one host and connections over the per-IP rate close with 4429.
- Messages over 1 MiB close the socket with 1009. Payloads are forwarded as they arrive and are never decrypted or
  logged.

One `Room` Durable Object per hostId holds the uplink and its sessions with the WebSocket Hibernation API, so an idle
host costs nothing.

## Self-hosting

You need a Cloudflare account with Workers enabled. Durable Objects on SQLite and the rate limiting binding are
available on the free plan.

1. In `wrangler.jsonc`, replace the `relay-doriface.omo.dev` route with a hostname on a zone in your account, or
   delete `routes` to serve from `doriface-relay.<your-subdomain>.workers.dev`.
2. Deploy:

   ```sh
   bun install
   cd apps/relay
   bunx wrangler login   # or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
   bunx wrangler deploy
   ```

   The first deploy applies the `v1` migration that creates the `Room` class.

3. Point hosts and clients at `https://<your hostname>`.

The per-IP limit (60 WebSocket upgrades per minute) is the `ratelimits` entry in `wrangler.jsonc`.

## Development

`bun run dev` serves the relay locally under workerd. The tests start their own `wrangler dev` on random ports
(Node 22 or newer must be on PATH for wrangler) and talk to it over real WebSockets:

```sh
bun test apps/relay packages/relay-client
```

The end-to-end test also needs herdr-core (`HC_BIN` or `hc` on PATH). Locally, workerd delays the TCP close of a
hibernatable socket that never sent a data frame by about 10 seconds (cloudflare/workerd#7566), so tests that close
sessions from the relay side send one frame first, as every real client does.
