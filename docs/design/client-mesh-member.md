# A client joins the mesh as its own member

Status: revision 2, 2026-11-06. Supersedes the version in `docs/design/client-mesh-member.md` shipped with #948, which the
security gate rejected. Issue #942. Every finding from that review is answered here, and the answers are decisions, not
options.

## 1. The problem, measured

A client's entire view is one herdr-core session to the host it paired with (`apps/web/src/connection/connect.ts`,
`apps/web/src/connection/store.ts` has no machine dimension), and every other machine is a line that host dials
(`apps/host/src/mesh/via.ts:7` builds `<program> connect --mesh …", `apps/host/src/connect/mesh-bridge.ts:56` asks the
running host for a line over `line.sock`). Measured live on 2026-11-06: 7 line clients, 7 distinct members, 7 machines in
herdr-core, one process serving all 7 through one socket. One process stopping takes all seven.

## 2. Bootstrap: the client must know the members without the host it paired with

This is the finding that decides whether the fix is real. A per-member session needs each member's Noise key, and the mesh
status document is advisory and carries fingerprints, not keys (`packages/protocol/src/mesh-status.ts`).

Decision: the roster is a **signed artefact the client persists**, anchored at admission, not a document it reads at
connect time.

- At admission the client receives the signed roster document and verifies it against the mesh's own signing key, which
  it pins at that moment. It stores the verified bytes.
- It refreshes from **any** member it can reach. A refresh is accepted only if it verifies against the pinned key and is
  newer by the roster's own sequence, so a survivor can update a client whose inviter is gone.
- Cold start needs no inviter: the client dials every member it holds a verified key for, in parallel, and the first
  answer refreshes the rest.
- Failover readiness is defined, not assumed: a member is dialable by a client when the client's persisted roster names it
  **and** that member's own copy names the client. Admission replication is complete when every member reachable at
  admission time has acknowledged the new entry; until then the client shows the members it can verify and says the roster
  is still settling, rather than showing a machine that will refuse it.
- The `--mesh` proxy path stays only for a machine that cannot be dialled directly. It is no longer the path the client's
  view depends on.

## 3. Identity: one classification, one place

Decision: **one roster, one index, a signed discriminant**. A member kind is a signed field of the member card, and
`AuthorizeIndex` classifies every key through the same generation-consistent snapshot.

- Kinds: `machine` (a Noise key that dials), `client` (a session key that connects). A key is one kind, decided by its
  admission, and a role change is a new admission, never an inference.
- `namedByAnother`, `claimsKey`, `cleanup`, and the 12-member cap span both kinds: a client counts as a member for the cap
  and for name conflicts, and is excluded from dialing.
- The existing refusal of a machine's device key (`apps/host/src/mesh/authorize-index.ts:188`) stays and is asserted by
  name. A client key never satisfies it, and a machine key never satisfies the client path.
- Why not a separate index beside the machine index: two indexes can disagree about the same key at the same generation,
  and the disagreement is unobservable from the outside. The discriminant makes the answer single-valued.

## 4. What a client can actually do, said plainly

A client on the `hc` stream is **owner-equivalent**. The gateway forwards plaintext to hc with no method policy
(`apps/host/src/gateway.ts:166-190`), so a client can call `doc.set` on `doriface-mesh-offer` and mint an auto-admitting
invitation (`apps/host/src/mesh/offer-doc.ts:43-48,108-120`). Denying the mesh stream does not contain that.

So the design states it instead of implying a smaller role: **admitting a client is granting that person the same control
of every machine they can reach as the owner has.** The admission copy says so, and the approval is per client, revocable
per client.

The stream matrix is explicit, and the nullish fallthrough is removed:

| Stream | machine | client | paired device |
|---|---|---|---|
| `"mesh"` | accepted (current member's Noise key) | **refused**: a client never dials | refused |
| `"push"` | refused: a machine has no browser | accepted only through its own paired-device entry, never through the member key | accepted |
| `"hc"` | accepted | accepted | accepted |
| loopback gateway | unchanged | classified through the same function as the relay path, not through a `??` default | unchanged |

`sessionPeer` returns an explicit decision per kind; `mesh ?? devicePeer(...)` is replaced, because that expression admits
anything the mesh layer merely declined to classify.

## 5. Revocation

- One signed revoke covers every member once it propagates. It is not instantaneous across a partition, and the design says
  so: a member that has not received the revoke keeps accepting that client until it does, which is the same exposure a
  revoked machine has today.
- `LiveSessions` and `closeRevoked` must learn the client role. Today a roster-only client is closed because it is neither
  a machine member nor a paired device (`apps/host/src/e2ee/sessions.ts:36-75`), which would drop a legitimate client while
  a revoked one lingers in a partition.
- A roster refusal overrides a stale paired entry: if the roster says refused, the session ends even if the per-host device
  store still holds the key.
- A revoke closes open sessions, not only future ones, including a handshake completing at the same moment; the sync path
  already has the callback (`apps/host/src/mesh/host-sync.ts:176-178`).
- The fail-closed DAG outcome applies to client subjects unchanged, with no client exception (`packages/mesh/src/fail-closed.ts:35-59`).

## 6. Identity keys and signing

The browser holds an X25519 key (`apps/web/src/connection/device-key.ts`), while roster cards require an Ed25519 signature
under `signPub` (`packages/mesh/src/records/codec.ts`).

Decision: a client member's card carries **its own Ed25519 signing identity**, and the card attests the X25519 session key
it will connect with. The attestation binds: the session key, the mesh, the inviter, a nonce, and the kind. Approval checks
that binding, so a captured card cannot be replayed into another mesh or re-pointed at another session key.

Clients are **not** record authors and not voters: `structure.authorized` and `testimony.voters` keep machine membership as
their input (`packages/mesh/src/view/structure.ts`, `packages/mesh/src/view/testimony.ts`). A client that could vote on the
roster would be a client that can admit itself.

## 7. Wire: a separate document, not a version bump of the shared one

Today's readers reject an unknown `v` and unknown nested fields whole
(`packages/protocol/src/mesh-status-parse.ts`, `mesh-status-guards.ts`), so a `v:2` status document buys nothing.

Decision: the signed roster publishes under **its own document name**. The v1 machine projection stays exactly as it is, so
every existing reader keeps working; new readers know both documents and treat the roster as the authority for membership.
Unknown kinds fail closed, an unsupported roster version is refused with a stated reason, and a downgrade never erases a
revocation.

## 8. Delivery and acceptance

- Stage 1 (PR #948): one vocabulary, one place. Under review.
- Stage 2: the roster document, the signed discriminant, the explicit stream matrix, the client role in sessions and
  revocation, and the admission copy that says a client is owner-equivalent.
- Stage 3: per-member client sessions and the capture Q asked for. Until it lands, the UI does not claim that one machine
  stopping leaves the others.

Acceptance for the whole item is the review's required-test list, adopted verbatim: client failover with the inviter
stopped during use, before reload, and before admission replication reached the survivors; the authorization suites
extended over every role, stream and session-kind combination including stale paired entries and cross-kind collisions; the
revocation suites covering open links, handshake races, stale indexes and partitions; the codec and view tests including
proof-of-possession, replay rejection, denied record and vote authority, mixed-kind admission at the cap; and the
compatibility fixtures for old and new reader-writer pairs, an unchanged v1 projection, unsupported versions, downgrade
refusal, and preserved revocations.
