# doriface transport contract v1.2

Layering, outermost first:

1. WebSocket, binary messages only, permessage-deflate off.
2. Relay routing header (relay path only, between relay and host; clients never see it).
3. Noise record layer (E2EE, `@doriface/crypto`): one WebSocket message = one Noise message.
4. Plaintext = a chunk of herdr-core's raw `hc connect` byte stream (JSON-RPC lines, then frames). The host never parses it; it pipes it to `hc connect`.

## Identities

- Host signing key: Ed25519 (`@noble/curves/ed25519`). `hostId` = lowercase base32 (RFC 4648, no padding) of the first 16 bytes of SHA-256(signPub) -> 26 chars.
- Host Noise static key: X25519.
- Client device static key: X25519, generated once per device; the web stores the raw private key in IndexedDB.
- Host fingerprint shown to people (contract v1.1): the first 20 bytes of SHA-256(noiseStaticPub), uppercase hex, as 10 groups of 4 characters (`3FA9 4C0E ...`). `doriface-host pair` and `doriface-host fingerprint` print it in that form.

## Pairing

- `doriface-host pair` prints a QR code and URL `<web origin>/pair#h=<hostId>&k=<noiseStaticPub b64url>&s=<signPub b64url>&c=<code>&r=<relay url>`. The fragment never reaches a server.
- Contract v1.1, typed code: 8 characters from the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, displayed as `XXXX XXXX`. Single use, expiring after 10 minutes. The host burns the code after 3 failed handshakes.
- The first 3 characters are the relay pairing slot; the last 5 are the secret, which never leaves the two devices. While pairing is open, the host's relay uplink registers the slot with the relay (control frame type 4 PAIR_SLOT, payload = 3 ASCII slot chars). A client that has only the typed code calls `GET /v1/pair/<slot>` and gets `{hostId, noiseStaticPub, signPub}`. That answer is untrusted; the psk and the fingerprint check (step 3 of the pairing UI) authenticate it. On a slot collision the relay answers 409 and the host draws a new code. A QR/URL pairing already carries hostId and keys, so it skips the slot lookup.
- The first session uses `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` with psk = HKDF-SHA256(ikm=UTF-8 of all 8 code chars, salt=empty, info="doriface pair v1", 32 bytes). A relay that impersonates the host can decrypt msg1, because psk2 is mixed in only at msg2. It cannot finish msg2 without the 25-bit secret, so it gets one online guess per code. msg1 therefore carries only `{"name": "<device name>"}` and nothing secret.
- On success the host appends `{clientStaticPub, name, pairedAt}` to its paired-devices store and burns the code.
- Every later session uses `Noise_IK_25519_ChaChaPoly_BLAKE2s`. The host rejects a client static key that is not in the store (close code 4401).
- Prologue for both patterns: UTF-8 `doriface/1` followed by the hostId bytes.
- Revoking a device removes it from the store and closes its live sessions.

## Record layer

- Noise transport messages use ChaCha20-Poly1305 (`@noble/ciphers`, synchronous) with 64-bit counter nonces as the Noise spec defines.
- Maximum plaintext per message: 65519 bytes. The sender chunks larger stream writes; the receiver concatenates in order.
- Rekey (Noise `REKEY()`) every 2^20 messages per direction.
- Any decryption failure closes the socket with code 4400. No reordering is tolerated, because WebSocket is ordered.
- Reconnect always runs a fresh IK handshake (1 RTT; msg1 may carry the first stream bytes).
- API: `secureLink(link: ByteLink, opts): Promise<ByteLink>` for the initiator and responder roles, where `ByteLink` is `@doriface/client`'s interface (`send(bytes)`, `onData(cb)`, `onClose(cb)`, `close()`).

## Relay (Cloudflare Workers + Durable Objects, `apps/relay`)

- Default public relay: `https://relay-doriface.omo.dev`. Self-hosting is one `wrangler deploy`.
- `GET /healthz` -> `{ok:true, version}`.
- Host uplink: `GET /v1/host/<hostId>` (WebSocket). The relay sends a 32-byte random challenge as the first binary message; the host answers with `signPub(32) || Ed25519-signature(64)` over `"doriface-relay-v1" || hostId || challenge`. The relay checks the signature and that `hostId` matches signPub, otherwise closes with 4403. One uplink per hostId; a newer authenticated uplink replaces the old one.
- Client: `GET /v1/client/<hostId>` (WebSocket). There is no relay-level auth (E2EE authenticates). Limits: 32 concurrent client sessions per host, connection rate limited per IP. An offline host closes the socket with 4404.
- One Durable Object per hostId (`idFromName(hostId)`), using the WebSocket Hibernation API. Socket attachments carry `{role, sessionId}`.
- Relay <-> host multiplexing frame: `[type u8][sessionId u32 LE][payload]`, with type 1 OPEN (no payload), 2 DATA (opaque bytes), 3 CLOSE (payload = u16 LE close code). The relay assigns sessionIds. Client <-> relay messages are the raw opaque bytes, with no header.
- The relay never decrypts, never logs payloads, enforces a 1 MiB message cap, and forwards immediately with no batching.

## Direct path

- The host also serves `GET /v1/e2ee` (WebSocket) on its LAN listener, speaking the same record layer without the relay header. Because every byte is authenticated, this endpoint may bind non-loopback. The plaintext `/v1/hc` stays loopback-only.
- Clients try direct (when a LAN URL is known and reachable within 300 ms) and the relay in parallel. The relay is the default; once a direct session's handshake completes, it is preferred. The session swap reattaches terminals with `resumed: true`.

## Close codes

- 4400: crypto failure
- 4401: unknown device
- 4403: relay auth failed
- 4404: host offline
- 4408: idle timeout
- 4429: rate limited

## v1.2 amendments (C2, resume without repaint, is deferred)

- C1 admission: a client session counts against the 32-session cap only after the host has sent its first DATA on it. Before that it is pending: at most 8 pending sessions per host, and 10 s to the host's first DATA (else close 4408). When the pending cap is full, evict the pending socket from the source IP that holds the most pending sockets.
- C3 backpressure: the receiver of relay traffic (client, or host uplink) sends a TEXT message `a:<total bytes received>` every 64 KiB. The Durable Object keeps `sent - acked` per socket in its attachment and closes the sending side with 4408 when it exceeds 4 MiB.
- C4 origin binding: the uplink signature covers `"doriface-relay-v1" || relayOrigin || hostId || challenge`, where relayOrigin is the exact `wss://host[:port]` the host dialed. The relay rebuilds it from its own request URL.
- C5 device key: the web generates the device static key as a non-extractable WebCrypto X25519 CryptoKey stored in IndexedDB. Static DHs use subtle.deriveBits; ephemeral DHs stay in @noble. If X25519 is unavailable in WebCrypto (feature check), fall back to raw bytes. packages/crypto therefore takes the local static DH as an async function `dh(pub): Promise<Uint8Array>`.
- C6 keepalive: exactly two TEXT messages are exempt from binary-only: `ping` (client or host to relay, every 30 s) and the relay's `pong` via setWebSocketAutoResponse. An alarm reaps sockets whose auto-response timestamp is more than 90 s old with 4408. On the direct path the host runs the same 90 s check.
- C7 pairing budget: the relay allows at most 10 `GET /v1/pair/<slot>` and 10 pairing-session OPENs per slot per 10 min (429/4429 beyond). The host burns a code only on success or expiry. This replaces "burn after 3 failed handshakes".
- C8 PAIR_SLOT payload: `slot (3 ASCII) || noiseStaticPub (32)` = 35 bytes; an empty payload clears the slot.
- Pinned details: the prologue is UTF-8 `doriface/1` followed by the 26 ASCII chars of hostId. The handshake payload is one JSON line, then raw stream bytes. Nonce n is not reset at rekey. Slot answer fields are base64url strings.
