# doriface transport contract v1.2

This is the binding wire contract for every doriface package. Each rule below is the current one; the change log at the end records what each revision changed.

Layering, outermost first:

1. WebSocket, binary messages only, permessage-deflate off. The only text messages are the three listed under "Relay text messages".
2. Relay routing header (relay path only, between relay and host; clients never see it).
3. Noise record layer (E2EE, `@doriface/crypto`): one WebSocket message = one Noise message.
4. Plaintext = a chunk of herdr-core's raw `hc connect` byte stream (JSON-RPC lines, then frames). The host never parses it; it pipes it to `hc connect`.

## Identities

- Host signing key: Ed25519 (`@noble/curves/ed25519`). `hostId` = lowercase base32 (RFC 4648, no padding) of the first 16 bytes of SHA-256(signPub) -> 26 chars.
- Host Noise static key: X25519.
- Client device static key: X25519, generated once per device. The web generates it as a non-extractable WebCrypto X25519 `CryptoKey` stored in IndexedDB, and uses `subtle.deriveBits` for the static DHs. When WebCrypto has no X25519 (feature check), it falls back to raw key bytes in IndexedDB. Ephemeral DHs always use `@noble/curves`. So `@doriface/crypto` takes the local static DH as an async function `dh(pub): Promise<Uint8Array>`.
- What a non-extractable key protects: same-origin script can still _use_ the key while the page is open, but it cannot copy the key bytes out. The raw-bytes fallback offers no such protection.
- Host fingerprint shown to people: the first 20 bytes of SHA-256(noiseStaticPub) (160 bits), uppercase hex, as 10 groups of 4 characters (`3FA9 4C0E ...`). `doriface-host pair` and `doriface-host fingerprint` print it in that form.

## Pairing

- `doriface-host pair` prints a QR code and URL `<web origin>/pair#h=<hostId>&k=<noiseStaticPub b64url>&s=<signPub b64url>&c=<code>&r=<relay url>`. The fragment never reaches a server.
- Typed code: 8 characters from the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, displayed as `XXXX XXXX`. It is single use and expires after 10 minutes. The host burns it only on success or expiry; failed attempts are limited by the relay's pairing budget below, so an attacker cannot burn a code by failing on purpose.
- The first 3 characters are the relay pairing slot; the last 5 are the secret (2^25 values), which never leaves the two devices.
- While pairing is open, the host's relay uplink registers the slot with a PAIR_SLOT control frame (see "Relay"). A client that has only the typed code calls `GET /v1/pair/<slot>` and gets `{hostId, noiseStaticPub, signPub}`: `hostId` is the 26-character lowercase base32 string defined above, and the two public keys are base64url strings without padding. That answer is untrusted; the psk and the fingerprint check (step 3 of the pairing UI) authenticate it. The relay answers each PAIR_SLOT with a PAIR_SLOT_ACK (see "Relay"); on a collision the host draws a new code and registers again. A QR/URL pairing already carries hostId and keys, so it skips the slot lookup.
- The first session uses `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` with psk = HKDF-SHA256(ikm = UTF-8 of all 8 code characters, salt = empty, info = "doriface pair v1", 32 bytes).
- On success the host appends `{clientStaticPub, name, pairedAt}` to its paired-devices store and burns the code.
- Every later session uses `Noise_IK_25519_ChaChaPoly_BLAKE2s`. The host rejects a client static key that is not in the store (close code 4401).
- Prologue for both patterns: UTF-8 `doriface/1` followed by the 26 ASCII characters of the hostId.
- Handshake payload: one JSON line (msg1 of IKpsk2 carries `{"name": "<device name>"}`), then raw stream bytes.
- Revoking a device removes it from the store and closes its live sessions.

### What a relay can learn during pairing

IK encrypts msg1 under a key derived from the responder's static key. Who can read msg1 depends on where the client got that key:

| Path       | Where the client gets the host's static key    | Can a malicious relay read msg1?                                                                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| QR / URL   | the URL fragment, which never reaches a server | No. The relay knows only the public key and cannot derive msg1's key.                                                                                                                                                                                                                                                                            |
| Typed code | the relay's `GET /v1/pair/<slot>` answer       | Yes. A relay that answers the lookup with its own static key reads msg1, which carries only the device name. It still cannot finish msg2, because psk2 is mixed in at msg2 and the relay does not know the 25-bit secret. It gets one online guess per attempt, capped by the pairing budget. The fingerprint check exposes the substituted key. |

So msg1 carries nothing secret, and the typed-code UI requires the fingerprint confirmation step.

## Record layer

- Noise transport messages use ChaCha20-Poly1305 (`@noble/ciphers`, synchronous) with 64-bit counter nonces as the Noise spec defines.
- Maximum plaintext per message: 65519 bytes. The sender chunks larger stream writes; the receiver concatenates in order.
- Rekey (Noise `REKEY()`) every 2^20 messages per direction. The nonce `n` is not reset at rekey.
- Any decryption failure closes the socket with code 4400. No reordering is tolerated, because WebSocket is ordered.
- Reconnect always runs a fresh IK handshake (1 RTT; msg1 may carry the first stream bytes). Resuming without a repaint is deferred.
- API: `secureLink(link: ByteLink, opts): Promise<SecureLink>` for the initiator and responder roles. `ByteLink` is `@doriface/client`'s interface (`send(bytes)`, `onData(cb)`, `onClose(cb)`, `close()`), and `SecureLink` is a `ByteLink` that also exposes the authenticated remote static key.

## Relay (Cloudflare Workers + Durable Objects, `apps/relay`)

- Default public relay: `https://relay-doriface.omo.dev`. Self-hosting is one `wrangler deploy`.
- `GET /healthz` -> `{ok:true, version}`.
- Host uplink: `GET /v1/host/<hostId>` (WebSocket). The relay sends a 32-byte random challenge as the first binary message. The host answers with `signPub(32) || Ed25519-signature(64)` over `"doriface-relay-v1" || relayOrigin || hostId || challenge`, where `relayOrigin` is the exact `wss://host[:port]` the host dialed. The relay rebuilds `relayOrigin` from its own request URL and checks the signature and that `hostId` matches signPub; otherwise it closes with 4403. Binding the origin stops a second relay from replaying a challenge from this one. One uplink per hostId; a newer authenticated uplink replaces the old one.
- Client: `GET /v1/client/<hostId>` (WebSocket). There is no relay-level auth (E2EE authenticates). An offline host closes the socket with 4404. A pairing session adds `?pair=<slot>`: the relay charges it to that slot's pairing budget, refuses it with 4410 when the slot is not registered to this hostId, and sends the host an OPEN whose payload is the 3 slot characters (an ordinary OPEN has no payload).
- Session admission: a client session counts against the 32-session cap only after the host has sent its first DATA on it. Before that it is pending: at most 8 pending sessions per host, with 10 s to the host's first DATA (else close 4408). When the pending cap is full, the relay evicts the pending socket from the source IP that holds the most pending sockets. Connections are also rate limited per IP (4429).
- One Durable Object per hostId (`idFromName(hostId)`), using the WebSocket Hibernation API. Socket attachments carry `{role, sessionId}`.
- Relay <-> host multiplexing frame: `[type u8][sessionId u32 LE][payload]`.
  - 1 OPEN: no payload, or the 3 slot characters for a pairing session.
  - 2 DATA: opaque bytes.
  - 3 CLOSE: payload = u16 LE close code.
  - 4 PAIR_SLOT (host to relay only, sessionId 0): payload = `slot (3 ASCII) || noiseStaticPub (32)` = 35 bytes. An empty payload clears the host's slot.
  - 5 PAIR_SLOT_ACK (relay to host only, sessionId 0): payload = `status u8` (0 registered, 1 slot taken by another host, 2 malformed) followed by the 3 slot characters. A host that gets status 1 draws a new code and sends PAIR_SLOT again.
- The relay assigns sessionIds. Client <-> relay messages are the raw opaque bytes, with no header.
- Pairing budget: at most 10 `GET /v1/pair/<slot>` and 10 pairing sessions (client connections with `?pair=<slot>`) per slot per 10 minutes (429 / 4429 beyond). Ordinary sessions are never charged to a slot.
- Per-source pairing quota: each source IP may make at most 3 `GET /v1/pair/<slot>` lookups and open at most 3 pairing sessions per slot per 10 minutes. The slot's session budget is charged only when the host has answered the session's IKpsk2 msg1 (its first DATA on that session). A single source therefore cannot drain either budget alone. Many independent sources still can, which denies pairing until the code expires but never reveals the secret, so the remedy is a new code.
- The relay never decrypts, never logs payloads, enforces a 1 MiB message cap, and forwards immediately with no batching.

### Relay text messages

Exactly three text messages are allowed on relay sockets; everything else must be binary:

| Message                    | Sender                                                                | Meaning                      |
| -------------------------- | --------------------------------------------------------------------- | ---------------------------- |
| `ping`                     | client or host, every 30 s                                            | keepalive                    |
| `pong`                     | the relay, via `setWebSocketAutoResponse` (no Durable Object wake-up) | keepalive reply              |
| `a:<total bytes received>` | the receiver of relay traffic (client or host uplink), every 64 KiB   | backpressure acknowledgement |

- Backpressure: the Durable Object keeps `sent - acked` per socket in its attachment and closes the sending side with 4408 when it exceeds 4 MiB. Acknowledgements are cumulative and must be monotonic: an `a:<n>` that is not a decimal integer, is smaller than the last acknowledgement, or is larger than the bytes actually sent to that socket is a protocol error and closes the socket with 4402, so a peer cannot ack bytes it never received to make the relay buffer without bound.
- Keepalive: an alarm reaps sockets whose auto-response timestamp is more than 90 s old, with 4408.
- Direct path: there is no relay, so the host itself answers each text `ping` with a text `pong`, and closes a `/v1/e2ee` socket with 4408 when it has received nothing (no record and no `ping`) for 90 s. Clients send `ping` every 30 s on the direct path too.

## Direct path

- The host also serves `GET /v1/e2ee` (WebSocket) on its LAN listener, speaking the same record layer without the relay header. Because every byte is authenticated, this endpoint may bind non-loopback. The plaintext `/v1/hc` stays loopback-only.
- Clients try direct (when a LAN URL is known and reachable within 300 ms) and the relay in parallel. The relay is the default; once a direct session's handshake completes, it is preferred. The session swap reattaches terminals with `resumed: true`.

## Close codes

- 4400: crypto failure
- 4402: relay protocol error (for example an invalid `a:<n>` acknowledgement)
- 4401: unknown device
- 4403: relay auth failed
- 4404: host offline
- 4410: pairing slot not registered to this host (expired or never opened)
- 4408: idle or backpressure timeout
- 4429: rate limited

## Change log

- v1.2: pending-session admission; the `a:<n>` backpressure acknowledgement; the relay origin in the uplink signature; non-extractable device keys with a raw fallback; `ping`/`pong` keepalive; the pairing budget moved to the relay, with codes burned only on success or expiry (replacing "burn after 3 failed handshakes"); PAIR_SLOT carrying the Noise static key, acknowledged by PAIR_SLOT_ACK; pairing sessions marked with `?pair=<slot>`; monotonic acknowledgements, rejected with 4402 when out of range; per-source quotas on pairing lookups and sessions, with the slot's session budget charged only after the host answers; close codes 4402 and 4410; direct-path keepalive; pinned prologue, payload and nonce rules. Resume without a repaint is deferred.
- v1.1: the 8-character typed code with a relay pairing slot; the SHA-256 hex fingerprint; the `doriface-host pair` and `doriface-host fingerprint` command names.
- v1: initial contract.
