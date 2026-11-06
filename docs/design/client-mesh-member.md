# A client joins the mesh as its own member

Status: revision 3, 2026-11-06. Supersedes revision 2 (rejected). Issue #942.

Revision 2 invented a single pinned "mesh signing key" and a global "roster sequence". Both are withdrawn: one signer is a
host dependency in new clothes, a shared private key cannot be revoked per signer, and a larger scalar cannot prove that a
survivor's snapshot still contains a revocation the client already holds. Revision 3 keeps the mesh's own signed DAG and
changes nothing about who signs what.

## 1. The problem, measured

A client's entire view is one herdr-core session to the host it paired with (`apps/web/src/connection/connect.ts`; the
store has no machine dimension), and every other machine is a line that host dials (`apps/host/src/mesh/via.ts:7`,
`apps/host/src/connect/mesh-bridge.ts:56`). Measured live 2026-11-06: 7 line clients, 7 distinct members, 7 machines in
herdr-core, one process serving all 7 through one socket.

## 2. Bootstrap: the client persists a verified bundle, not a snapshot

`RecordBody` is already a signed DAG — one signer per record, its own counter `n`, and `prev` parents
(`packages/mesh/src/records/types.ts:43-51`) — and `checkWelcome` already validates exactly this shape at admission
(`apps/host/src/mesh/join.ts:61-86`): every record through `door`, exactly one `found` for the offered mesh, the inviter a
member, its key the key that was dialled.

So the client's persisted artefact is **the welcome bundle it was admitted with**, plus every verified record it later
learns, and membership is `viewOf(records)` over that set.

- Anchor: the bundle's `found` record fixes the meshId and genesis. Admission checks run unchanged; nothing replaces
  `checkWelcome`'s conditions.
- Refresh: the client asks any member it can reach for records it does not hold. Each record is validated through `door`
  against the client's own set before it is kept, so an unverifiable record is refused rather than merged.
- Merge is a **union with history retention**: records already held are never dropped because a peer's response omitted
  them. A response that lacks a revocation the client holds cannot erase it, and no counter or snapshot number can
  override that rule. This is the specific failure revision 2 admitted.
- Cold start never needs the inviter: the client holds keys for every member its bundle names, and dials them in parallel;
  the first answer contributes records, not authority.
- Failover readiness is defined: a member is dialable when the client's bundle names it and that member's own view names
  the client. Until both hold, the UI shows the roster as settling rather than a machine that will refuse the session.
- The `--mesh` proxy stays only for a machine that cannot be dialled directly.

## 3. Identity: one classification, one place

One roster, one generation-consistent `AuthorizeIndex`, a signed role on the member card, shared collision and cap
accounting across both kinds, and the machine-device refusal preserved and asserted by name
(`apps/host/src/mesh/authorize-index.ts:188`). A role change is a new admission, never an inference. Two indexes are
rejected because they can disagree unobservably at the same generation.

## 4. What a client can actually do, said plainly

A client on the `hc` stream is **owner-equivalent**: the gateway forwards plaintext to hc with no method policy
(`apps/host/src/gateway.ts:166-190`), so `doc.set` on `doriface-mesh-offer` mints an auto-admitting invitation
(`apps/host/src/mesh/offer-doc.ts:43-48,108-120`). Denying the mesh stream contains nothing. Admitting a client grants
control of every machine it can reach, and the approval copy says so.

The stream matrix is explicit, and the `??` fallthrough is removed:

| Stream | machine | client | paired device |
|---|---|---|---|
| `"mesh"` | accepted | refused: a client never dials | refused |
| `"push"` | refused: a machine has no browser | accepted only through its own **role-aware** push association, never through the member key | accepted |
| `"hc"` | accepted | accepted | accepted |
| loopback gateway | unchanged: token-authenticated local owner | same | same |

Two details the previous revision left ambiguous, now decided:

- **Push for a client is a separate association, and the roster wins.** The cleanup that removes paired devices whose keys
  belong to a mesh member (`apps/host/src/state/mesh.ts:190-195`) must recognise a client member's *session* key as its own
  push identity and keep it, while `admitPairing`'s refusal of a `claimsKey` match (`apps/host/src/e2ee/accept.ts:193-196`)
  must keep refusing a **machine's** keys. Roster refusal overrides the association in both directions.
- **The loopback gateway authenticates a token, not an X25519 identity.** It keeps `checkHandshake` and `checkBearer`
  (`apps/host/src/gateway.ts:116-145`) and is described as a distinct authenticated local-owner principal, not as a row in
  the same identity table.
- The prohibition on a client announcing a machine's `core.id` stays, with its regression test
  (`apps/host/src/e2ee/first-line.ts:13-22`).

## 5. Revocation

One signed revoke covers every member as it propagates; it is not instantaneous across a partition, and the design says so.
`LiveSessions` and `closeRevoked` learn the client role (today a roster-only client is closed because it is neither a
machine member nor a paired device, `apps/host/src/e2ee/sessions.ts:36-75`); a roster refusal overrides a stale paired
entry; a revoke closes open sessions and a concurrently completing handshake
(`apps/host/src/mesh/host-sync.ts:176-178`); the fail-closed DAG outcome applies to client subjects unchanged
(`packages/mesh/src/fail-closed.ts:35-59`). A refresh can never circumvent these, because §2 keeps known records.

## 6. Identity keys and signing

The browser holds X25519 (`apps/web/src/connection/device-key.ts`); cards are Ed25519-signed under `signPub`. A client
member's card carries its own Ed25519 signing identity and attests the X25519 session key, bound to the mesh, the inviter,
a nonce and the kind. Clients are not record authors and not voters (`packages/mesh/src/view/structure.ts`,
`testimony.ts`); they count against the 12-member cap and never dial.

## 7. Wire: new card and record versions, legacy means machine

The current card parser accepts `v: 1` and **drops unrecognised fields** (`packages/mesh/src/records/codec.ts:134-154`), and
the persisted member parser drops anything it does not name (`apps/host/src/state/mesh-file.ts:36-42`). A card carrying
`kind: client` would therefore lose that distinction on an old reader and be read as a machine — the one outcome that must
never happen silently.

- A client admission is a new **card version** carrying the kind, and a new **record type** for the admission itself.
- The persisted index gains a version; a reader that does not know it refuses the index instead of reading it partially.
- A v1 card means **machine only**. There is no reinterpretation in either direction.
- Upgrade gate: a host that cannot parse the new card version refuses a client admission with a stated reason and says it
  needs an update; it never admits the client as a machine.
- The advisory status document is untouched, so every existing reader keeps working.

## 8. Delivery, and the tests this must pass

Stage 1 (PR #948) is the vocabulary. Stage 2 is §3 through §7. Stage 3 is per-member client sessions and the capture Q
asked for, and until it lands the UI does not claim one machine stopping leaves the others.

Tests, from the gate verbatim, adopted as acceptance:

- Bundle and bootstrap: founder offline, founder revoked, concurrent histories, and a higher-numbered or larger snapshot
  that omits a revocation the client already holds (must not erase it); a record failing `door` is refused, not merged.
- Authorization: every role, stream and session-kind combination; stale paired entries; cross-kind collisions; rotation;
  re-admission; `core.id` impersonation; a client refused on `mesh` and a machine's device key still refused.
- Revocation: open links, handshake races, stale indexes, partitions, undecidable revokes.
- Codec and view: proof of possession, replay rejection, denied record and vote authority, mixed-kind admission at 12 and
  13, no client dialing or witness participation.
- Compatibility, against the **actual old parsers**: a v1 reader given a v2 client card must fail closed rather than read
  it as a machine; a persisted index of an unknown version is refused; downgrade never erases a revocation; the unchanged
  v1 status projection still parses.
