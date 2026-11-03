# doriface transport contract v1.3

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
- Pairing secrets, one set per pairing offer: the 8-character typed code (25 secret bits, used only as a CPace password) and a 32-byte random link secret (carried only in the pairing URL fragment). Neither is ever used directly as a key. Typed-code pairing binds `hostId`, the host Noise static key and the slot into the PAKE, so a code typed for one host cannot be used against another.

## Pairing

- `doriface-host pair` opens one pairing offer (replacing any pending one) and prints a QR code, the URL `<web origin>/pair#h=<hostId>&k=<noiseStaticPub b64url>&s=<signPub b64url>&p=<link secret b64url>&r=<relay url>`, the typed code, the fingerprint, the hostId and the expiry. The fragment never reaches a server. The link secret is 32 random bytes (43 base64url characters without padding).
- An offer lives 10 minutes and is single use: the first pairing that completes, by either path, burns the code and the link secret together.
- Typed code: 8 characters from the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, displayed as `XXXX XXXX`. Input is normalized: uppercase, spaces and `-` dropped, `O` read as `0`, `I` and `L` read as `1`. The first 3 characters are the relay pairing slot; the last 5 are the secret (2^25 values), which never leaves the two devices and is never sent in any form an observer can test offline.
- While the typed code is open, the host's relay uplink registers the slot with a PAIR_SLOT control frame (see "Relay"). A client that has only the typed code calls `GET /v1/pair/<slot>` and gets `{hostId, noiseStaticPub, signPub}`: `hostId` is the 26-character lowercase base32 string defined above, and the two public keys are base64url strings without padding. That answer is untrusted; the client checks that `hostId` matches `signPub`, the person confirms the fingerprint, and the PAKE below authenticates it. The relay answers each PAIR_SLOT with a PAIR_SLOT_ACK (see "Relay"); on a collision the host draws a new code and registers again. A QR/URL pairing already carries hostId and keys, so it skips the slot lookup.
- Failed typed-code attempts: the host counts every typed-code attempt it answers (see "Session kinds" below) and persists the count with the offer. After 10 answered attempts it retires the typed code: it clears its relay slot and answers no further typed-code attempt (4429). The link secret stays valid until the offer expires. Each answered attempt tests exactly one guess, so an attacker's chance to learn a code is at most 10 in 2^25 per offer, whatever the relay does. Attempts that the host refuses before answering are not counted. Anyone who can make 10 answered attempts (through the relay's budget below) can retire a code but cannot learn it; the remedy is the QR/link or a new code.
- On success the host appends `{clientStaticPub, name, pairedAt}` to its paired-devices store and burns the offer. The offer is burned before the device is stored, so a failed store never leaves it usable.
- Revoking a device removes it from the store and closes its live sessions.

### Session kinds

The first message a client sends on every session (relay or direct) starts with one kind byte:

| kind   | Name      | Rest of the first message                      | Noise protocol                          | Prologue                                              |
| ------ | --------- | ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `0x01` | session   | Noise message 1                                | `Noise_IK_25519_ChaChaPoly_BLAKE2s`     | `doriface/1` \|\| hostId \|\| `0x01`                  |
| `0x02` | pair-code | `sid` (16) \|\| `Ya` (32) \|\| Noise message 1 | `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` | `doriface/1` \|\| hostId \|\| `0x02` \|\| sid \|\| Ya |
| `0x03` | pair-link | Noise message 1                                | `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` | `doriface/1` \|\| hostId \|\| `0x03`                  |

`doriface/1` is its 10 UTF-8 bytes and hostId its 26 ASCII characters. Any other kind byte, or a first message outside its kind's size bounds, is closed with 4400 and never answered. The host's first message is Noise message 2, preceded for kind `0x02` by the host's CPace share `Yb` (32 bytes). The client's first transport record after message 2 has an empty plaintext; it confirms the keys, and the host stores a paired device, or releases IK early data, only after decrypting it. `lv_cat` and `prepend_len` are as in draft-irtf-cfrg-cpace-21 section 6.3 and Appendix A.1: each field is prefixed with its length in LEB128 and the results are concatenated.

A v1.2 first message is never answered. It has no kind byte, so its first byte is the first byte of a random ephemeral key: an unknown kind, or a message outside the kind's size bounds, is closed before any crypto; a v1.2 message that passes the size bounds of kind `0x02` or `0x03` fails message-1 authentication under the v1.3 prologue; one that starts with `0x01` fails message 1 because the IK prologue now ends in `0x01`. Each is closed with 4400.

- Session (`0x01`): every session after pairing. The host rejects a client static key that is not in the store (4401). A relay session opened with `?pair` carries only pairing; kind `0x01` on it is closed with 4401 without an answer.
- Pair-link (`0x03`, the QR/URL path): psk = HKDF-SHA512(ikm = link secret, salt = empty, info = lv_cat(`doriface/1.3 pair-link psk`, UTF-8 hostId, noiseStaticPub), 32 bytes). The client dials an ordinary relay session (no `?pair`), or the direct path.
- Pair-code (`0x02`, the typed path): CPace, cipher suite CPACE-RISTR255-SHA512 of draft-irtf-cfrg-cpace-21 (section 8.3), initiator-responder mode with the client as initiator A and the host as responder B:
  - PRS = UTF-8 of the 8 normalized code characters.
  - CI = lv_cat(`doriface/1.3 CPace pair-code`, `A=device`, `B=host`, UTF-8 hostId, noiseStaticPub, UTF-8 slot).
  - sid = 16 random bytes chosen by the client per attempt; ADa = ADb = empty; transcript = transcript_ir. Because the client chooses sid, an attacker can precompute the generators of every code for a sid of its choice; that makes each online attempt cheaper to compute but adds no attempt and allows no offline test.
  - Generator, scalar sampling (32 random bytes, the top 4 bits cleared, zero redrawn), `scalar_mult_vfy` (an invalid or identity encoding aborts) and ISK are exactly as the draft specifies. K is never exposed.
  - psk = HKDF-SHA512(ikm = ISK, salt = empty, info = `doriface/1.3 pair-code psk`, 32 bytes), used as the IKpsk2 psk, which Noise mixes after the `se` token of message 2.
  - The host accepts kind `0x02` only on a relay session opened with `?pair=<slot>` whose slot belongs to its live, unretired offer. On the direct path, on an ordinary relay session, or for another slot it closes with 4401 without answering. Before answering it checks `Ya` and message 1, then records the attempt durably. If the host cannot record the attempt it closes with 1011 and answers nothing. Reaching 10 retires the code for new attempts; sessions the host has already answered may still complete.

Message sizes: a client's first message is at most 4449 bytes for kind `0x01`, 401 for `0x02` and 353 for `0x03`. The host's first message is at most 304 bytes (336 for `0x02`).

### Handshake payloads

- Every handshake payload starts with one JSON line: a UTF-8 JSON object followed by LF (0x0A), at most 256 bytes including the LF, whose `v` member is the number `1`. Receivers ignore unknown members. A payload that breaks a rule below fails the handshake with 4400.
- Message 1 of a session (`0x01`): `{"v":1}`, then up to 4096 early stream bytes (normally the `hc` hello line), which the host delivers only after key confirmation.
- Message 1 of a pairing (`0x02`, `0x03`): `{"v":1,"name":"<device name>"}` and nothing after the line. After trimming leading and trailing white space (ECMAScript `String.prototype.trim`), the name is 1 to 64 UTF-16 code units, well-formed (no lone surrogates), and contains no character of the Unicode categories Cc, Cf, Zl or Zp. The host stores the trimmed name.
- Message 2 (every kind): `{"v":1,"lan":[...]}` and nothing after the line. `lan` holds at most 8 strings, each `ws://<IPv4 literal or bracketed IPv6 literal>:<port 1-65535>/v1/e2ee` that parses as a WHATWG URL; never a host name. The host sends the longest leading run of its LAN URLs that keeps the line within 256 bytes. A client refuses the whole reply if any entry breaks this rule.
- A handshake that has not completed within 10 s is closed with 4408, and so is one that buffers more than 4 MiB of unread bytes.

### What a relay can learn during pairing

| Path                               | Where the client gets the host's static key    | What a malicious relay can do                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR / URL (`0x03`)                  | the URL fragment, which never reaches a server | Nothing beyond sizes and timing. It cannot read message 1 (it is encrypted to the real host key), and the psk comes from a 256-bit secret it never sees, so it has nothing to test, online or offline.                                                                                                                                                                             |
| Typed code (`0x02`), honest lookup | the relay's `GET /v1/pair/<slot>` answer       | It sees the slot, sid, both CPace shares and the Noise ciphertexts. None of them depends on the code except through the CPace key, which needs a Diffie-Hellman value the relay cannot compute, so it cannot test a guess offline. Sessions it opens itself each give it one online guess per answer the host sends, and the host answers at most 10 per offer.                    |
| Typed code (`0x02`), lying lookup  | the relay's `GET /v1/pair/<slot>` answer       | If it answers with its own static key, it can read message 1 (the device name and the device's public static key) and gets one online guess per attempt the person makes. It cannot pass the attempt on to the real host, because the PAKE is bound to the host identity and slot the client was given, and the fingerprint check shows the person a key that is not their host's. |

So message 1 carries nothing secret, every code guess costs an answer from the real host, and the typed-code UI keeps the fingerprint confirmation step.

Residual risk: `hostId` binds only `signPub`, so a lying lookup can return the real `hostId` and `signPub` with a substituted Noise static key and still pass the client's `hostId` check. The PAKE then gives the substitute one online guess per attempt and no way to reach the real host, and only the fingerprint check catches the substitution. Signing the PAIR_SLOT key with `signPub` would remove this row; it is a planned relay change.

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
- Host uplink: `GET /v1/host/<hostId>` (WebSocket). The relay sends a 32-byte random challenge as the first binary message. The host answers with `signPub(32) || Ed25519-signature(64)` over `"doriface-relay-v1" || relayOrigin || hostId || challenge`, where `relayOrigin` is the exact `wss://host[:port]` the host dialed. The relay rebuilds `relayOrigin` from its own request URL and checks the signature and that `hostId` matches signPub; otherwise it closes with 4403. Binding the origin stops a second relay from replaying a challenge from this one. One uplink per hostId; a newer authenticated uplink replaces the old one, which the relay closes with 4409.
- Client: `GET /v1/client/<hostId>` (WebSocket). There is no relay-level auth (E2EE authenticates). An offline host closes the socket with 4404. A typed-code pairing session adds `?pair=<slot>`: the relay charges it to that slot's pairing budget, refuses it with 4410 when the slot is not registered to this hostId, and sends the host an OPEN whose payload is the 3 slot characters (an ordinary OPEN has no payload). A QR/URL pairing is an ordinary session.
- Session admission: a client session counts against the 32-session cap only after the host has sent its first DATA on it. Before that it is pending: at most 8 pending sessions per host, with 10 s to the host's first DATA (else close 4408). When the pending cap is full, the relay evicts the pending socket from the source IP that holds the most pending sockets. Connections are also rate limited per IP (4429).
- One Durable Object per hostId (`idFromName(hostId)`), using the WebSocket Hibernation API. Socket attachments carry `{role, sessionId}`.
- Relay <-> host multiplexing frame: `[type u8][sessionId u32 LE][payload]`.
  - 1 OPEN: no payload, or the 3 slot characters for a pairing session.
  - 2 DATA: opaque bytes.
  - 3 CLOSE: payload = u16 LE close code.
  - 4 PAIR_SLOT (host to relay only, sessionId 0): payload = `slot (3 ASCII) || noiseStaticPub (32)` = 35 bytes. An empty payload clears the host's slot; the host sends it when the offer ends and when it retires the typed code.
  - 5 PAIR_SLOT_ACK (relay to host only, sessionId 0): payload = `status u8` (0 registered, 1 slot taken by another host, 2 malformed) followed by the 3 slot characters. A host that gets status 1 draws a new code and sends PAIR_SLOT again.
- The relay assigns sessionIds. Client <-> relay messages are the raw opaque bytes, with no header.
- Pairing budget: at most 10 `GET /v1/pair/<slot>` and 10 pairing sessions (client connections with `?pair=<slot>`) per slot per 10 minutes (429 / 4429 beyond). Ordinary sessions are never charged to a slot.
- Per-source pairing quota: each source IP may make at most 3 `GET /v1/pair/<slot>` lookups and open at most 3 pairing sessions per slot per 10 minutes; a refused lookup gets HTTP 429 and a refused session is closed with 4429, the same responses as the slot budget. The slot's session budget is charged only when the host has answered the session's pairing message (its first DATA on that session); a session the host closes without answering is not charged. A single source therefore cannot drain either budget alone. Many independent sources still can, which denies typed-code pairing for that code but never reveals the secret, so the remedy is the QR/link or a new code. The host's own limit of 10 answered attempts per offer (see "Pairing") holds even against a relay that ignores these budgets.
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

- The host also serves `GET /v1/e2ee` (WebSocket) on its LAN listener, speaking the same record layer without the relay header. Because every byte is authenticated, this endpoint may bind non-loopback. The plaintext `/v1/hc` stays loopback-only. It accepts session kinds `0x01` and `0x03`; it closes kind `0x02` (typed-code pairing, which needs the relay's budget) with 4401 without answering.
- Clients try direct (when a LAN URL is known and reachable within 300 ms) and the relay in parallel. The relay is the default; once a direct session's handshake completes, it is preferred. The session swap reattaches terminals with `resumed: true`.

## Close codes

- 4400: crypto failure, including an unknown session kind, a malformed first message, an invalid CPace share, or a key confirmation that does not decrypt
- 1011: the host failed internally (for example it could not record a typed-code attempt); nothing was answered
- 4401: unknown device, or a pairing the host does not accept here: no live offer, an offer already used, a typed-code pairing on the direct path or without `?pair`, a slot that is not the offer's, or a session kind `0x01` on a `?pair` session
- 4402: relay protocol error (for example an invalid `a:<n>` acknowledgement)
- 4403: relay auth failed
- 4404: host offline
- 4408: idle or backpressure timeout, or a handshake that did not finish within 10 s
- 4409: uplink replaced by a newer authenticated uplink for this hostId; the replaced host must not reconnect
- 4410: pairing slot not registered to this host (expired, retired or never opened)
- 4429: rate limited, including a typed code whose 10 answered attempts are spent

## Change log

- v1.3: typed-code pairing uses CPace (CPACE-RISTR255-SHA512, draft-irtf-cfrg-cpace-21) bound to hostId, the host Noise static key, the slot and a per-attempt session id; its key is the IKpsk2 psk, so every code guess costs one answer from the real host and no relay or observer can test a guess offline (v1.2 let one message 2 test every code). The pairing URL carries a 32-byte link secret (`p=`) instead of the code. Every session's first message starts with a kind byte (`0x01` session, `0x02` pair-code, `0x03` pair-link), bound into the prologue. The host retires a typed code after 10 answered attempts per offer and refuses typed-code pairing on the direct path. The handshake payload rules (`"v":1`, the message 2 `lan` reply, the 256-byte line, the 64-unit name and the 4096-byte early data) and the empty key-confirmation record are now written down. v1.2 pairing and session messages are refused.
- v1.2.1: close code 4409 (uplink replaced), which the relay already sends when a newer uplink authenticates for the same hostId.
- v1.2: pending-session admission; the `a:<n>` backpressure acknowledgement; the relay origin in the uplink signature; non-extractable device keys with a raw fallback; `ping`/`pong` keepalive; the pairing budget moved to the relay, with codes burned only on success or expiry (replacing "burn after 3 failed handshakes"); PAIR_SLOT carrying the Noise static key, acknowledged by PAIR_SLOT_ACK; pairing sessions marked with `?pair=<slot>`; monotonic acknowledgements, rejected with 4402 when out of range; per-source quotas on pairing lookups and sessions, with the slot's session budget charged only after the host answers; close codes 4402 and 4410; direct-path keepalive; pinned prologue, payload and nonce rules. Resume without a repaint is deferred.
- v1.1: the 8-character typed code with a relay pairing slot; the SHA-256 hex fingerprint; the `doriface-host pair` and `doriface-host fingerprint` command names.
- v1: initial contract.
