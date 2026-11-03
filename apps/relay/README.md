# @doriface/relay

The Cloudflare Workers + Durable Objects relay that carries doriface traffic when a client cannot reach its host
directly. It implements the relay part of transport contract v1.2 (`docs/transport.md`):

- `GET /healthz` answers `{"ok": true, "version": "..."}`.
- `GET /v1/host/<hostId>` (WebSocket) is the host uplink. The relay sends a 32-byte challenge; the host answers
  `signPub || Ed25519 signature` over `"doriface-relay-v1" || relayOrigin || hostId || challenge`, where
  `relayOrigin` is the `wss://host[:port]` the host dialed. A wrong key, signature or origin closes with 4403, and a
  newer authenticated uplink replaces the old one (closed with 4409, its sessions with 4404).
- `GET /v1/client/<hostId>` (WebSocket) opens a client session. Each session is multiplexed onto the uplink as
  `[type u8][sessionId u32 LE][payload]` frames (1 OPEN, 2 DATA, 3 CLOSE, 4 PAIR_SLOT, 5 PAIR_SLOT_ACK). An offline host
  closes the client with 4404. `?pair=<slot>` marks an IKpsk2 pairing session: its OPEN carries the slot, and a slot
  not registered to this host closes the client with 4410.
- `GET /v1/pair/<slot>` answers `{hostId, noiseStaticPub, signPub}` (base64url) for a host whose uplink registered
  the 3-character pairing slot in the last 10 minutes, 404 otherwise. PAIR_SLOT carries `slot || noiseStaticPub`
  (35 bytes) to register and an empty payload to clear the host's registered slot. The relay answers each with a
  PAIR_SLOT_ACK, `status u8` (0 registered, 1 taken by another host, 2 malformed) followed by the slot; a clear when
  no slot is registered has no slot to name and gets no answer.

Limits and controls:

| Rule                                                | Value                                                                                                                                                                                             | Refusal                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Message size                                        | 1 MiB per relay message; client payloads are at most 1 MiB - 5 B so the uplink DATA frame fits too                                                                                                | close 1009                                                                                      |
| Active sessions per host (C1)                       | 32; a session counts once the host has sent DATA on it                                                                                                                                            | 4429                                                                                            |
| Pending sessions per host (C1)                      | 8, each with 10 s to the host's first DATA                                                                                                                                                        | 4408; when full, the oldest pending session of the source holding the most is evicted with 4429 |
| Unacked bytes per socket (C3)                       | receivers send the text `a:<total bytes received>` every 64 KiB; over 4 MiB unacked the sending side is closed                                                                                    | 4408; an ack that is malformed, goes backwards or exceeds what was sent: 4402                   |
| Keepalive (C6)                                      | `ping` text every 30 s, answered `pong` without waking the object; an alarm reaps sockets with no ping for 90 s                                                                                   | 4408                                                                                            |
| Pairing budget (C7)                                 | per slot: 10 lookups and 10 answered pairing sessions per 10 minutes, a session counting once the host sends its first DATA; per source: 3 lookups and 3 pairing sessions per slot per 10 minutes | 429 / 4429                                                                                      |
| Per-source connection rate (IPv4 address, IPv6 /64) | 60 WebSocket upgrades and 20 pairing lookups per minute                                                                                                                                           | 4429 / 429                                                                                      |

Payloads are forwarded as they arrive and are never decrypted, parsed or logged. One `Room` Durable Object per
hostId holds the uplink and its sessions with the WebSocket Hibernation API (all per-socket state lives in socket
attachments), and one `PairSlot` object per pairing slot holds the slot and its budget until its cleanup alarm.

The relay cannot tell a pairing handshake from a regular one, because it never reads payloads: the pairing budget
binds clients that dial with `?pair=<slot>` (as `connectRelayClient({ pairSlot })` does), and the host learns a
session is a pairing one from its OPEN (`SessionLink.pairSlot`). The 25-bit secret in the code, not the budget, is
what keeps pairing safe.

## Self-hosting

You need a Cloudflare account with Workers enabled. Durable Objects on SQLite and the rate limiting binding are
available on the free plan.

1. In `wrangler.jsonc`, replace the `relay-doriface.omo.dev` route with a hostname on a zone in your account, or
   delete `routes` to serve from `doriface-relay.<your-subdomain>.workers.dev`.
2. Deploy (wrangler needs Node 22 or newer on PATH):

   ```sh
   bun install
   cd apps/relay
   bunx wrangler login   # or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
   bunx wrangler deploy
   ```

   The first deploy applies the `v1` migration that creates the `Room` and `PairSlot` classes.

3. Check `https://<your hostname>/healthz`, then point hosts and clients at `https://<your hostname>`. Hosts sign
   over the relay origin they dial, so use the exact hostname the relay serves.

The per-IP limits are the `ratelimits` entries in `wrangler.jsonc`. The public relay deploys from `dev` through
`.github/workflows/deploy-relay.yml`, which waits for `/healthz` to answer `ok: true`.

## Development

`bun run dev` serves the relay locally under workerd. The tests run the real Worker under workerd with
`wrangler dev` on random ports and talk to it over real WebSockets from `bun test`, rather than inside
`@cloudflare/vitest-pool-workers`: that way the tests exercise the same `@doriface/relay-client` uplink and
connector that hosts and clients ship, and the end-to-end test can pipe a real `hc`. Timeout tests start a second
instance with `--var PENDING_TIMEOUT_MS:... --var IDLE_TIMEOUT_MS:...`.

```sh
bun test apps/relay packages/relay-client
```

Node 22 or newer must be on PATH for wrangler. The end-to-end test also needs herdr-core (`HC_BIN` or `hc` on PATH).
Locally, workerd delays the TCP close of a hibernatable socket that never sent a data frame by about 10 seconds
(cloudflare/workerd#7566), so tests that close sessions from the relay side send one frame first, as every real
client does.
