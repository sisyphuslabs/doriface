import { base64urlEncode, type HostIdentity } from "@doriface/crypto";
import {
  type CardBody,
  hashOf,
  parseRecord,
  type RecordBody,
  type Signed,
  verifyCard,
  type View,
  ViewCache,
  viewOf,
} from "@doriface/mesh";
import type { MeshStatus } from "@doriface/protocol";
import { isRecord } from "../state/files.ts";
import type { MeshFile } from "../state/mesh-file.ts";
import { ownN } from "../state/mesh-tx.ts";
import type { MeshStore } from "../state/mesh.ts";
import type { MeshLiveFacts, MeshHooks } from "./host-hooks.ts";
import type { LocalFacts, MeshSources, RevocationFact } from "./status-sources.ts";
import { hostIdOfKey, meshStatus } from "./status.ts";
import { witnessFacts } from "./witness.ts";

// `mesh status` on the running host (design 8.6): the stored part of PR 7's MeshSources read from mesh.json and its
// view, the live part from the mesh hooks.

interface Parsed {
  readonly hash: string;
  readonly body: RecordBody;
}

const parsedOf = (records: readonly Signed[]): readonly Parsed[] =>
  records.flatMap((record) => {
    const body = parseRecord(record);
    return body === undefined ? [] : [{ hash: hashOf(record), body }];
  });

function cardsOf(parsed: readonly Parsed[], key: string): readonly CardBody[] {
  return parsed.flatMap(({ body }) => {
    const card = body.subject !== undefined && "card" in body.subject ? verifyCard(body.subject.card) : undefined;
    return card?.signPub === key ? [card] : [];
  });
}

/** The revoke behind every revoked key: its effective revokes' signers, the latest one's reason and time. */
function revocationsOf(parsed: readonly Parsed[], view: View): ReadonlyMap<string, RevocationFact> {
  const facts = new Map<string, RevocationFact>();
  for (const key of view.revoked) {
    const naming = parsed.filter(({ body }) => {
      const subject = body.subject;
      return body.type === "revoke" && subject !== undefined && "signPubs" in subject && subject.signPubs.includes(key);
    });
    const revokes = naming.filter(({ hash }) => view.eff.has(hash));
    const latest = revokes.at(-1)?.body;
    const card = cardsOf(parsed, key).at(-1);
    if (latest?.subject === undefined || !("reason" in latest.subject) || card === undefined) continue;
    const renamed = parsed
      .flatMap(({ body }) =>
        body.subject !== undefined && "name" in body.subject && body.subject.signPub === key ? [body.subject.name] : [],
      )
      .at(-1);
    facts.set(key, {
      name: renamed ?? card.name,
      noisePub: card.noisePub,
      by: [...new Set(revokes.map(({ body }) => body.by))],
      reason: latest.subject.reason,
      at: latest.at ?? null,
    });
  }
  return facts;
}

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

function dateOf(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localOf(file: MeshFile, view: View, self: string, live: MeshLiveFacts): LocalFacts {
  const keys = [...view.members, ...view.overCap, ...view.revoked];
  const byHostId = new Map(keys.map((key) => [hostIdOfKey(key), key]));
  const localNames = new Map(
    Object.entries(file.local).flatMap(([hostId, entry]) => {
      const key = byHostId.get(hostId);
      const name = field(entry, "name");
      return key === undefined || typeof name !== "string" ? [] : [[key, name] as const];
    }),
  );
  const noticed = new Map(
    Object.entries(file.notices).flatMap(([key, entry]) => {
      const seen = dateOf(field(entry, "seenAt"));
      return seen === null ? [] : [[key, seen] as const];
    }),
  );
  return {
    meshId: file.meshId,
    self,
    generation: file.generation,
    records: file.records.length,
    counter: { file: file.selfN, mesh: Math.max(ownN(file.records, self), live.peerCounter) },
    localNames,
    noticed,
    readOnlyUntil: dateOf(file.readOnlyUntil),
    possiblyRevoked: live.possiblyRevoked,
  };
}

export function meshSourcesOf(
  file: MeshFile,
  view: View,
  self: string,
  live: MeshLiveFacts,
  cache: ViewCache = new ViewCache(),
): MeshSources {
  const parsed = parsedOf(file.records);
  /** The founder is admitted by its own found record; PR 7's ViewFacts gives it no admitter. */
  const foundHash = parsed.find(({ body }) => body.type === "found")?.hash;
  return {
    view: {
      members: view.members,
      overCap: view.overCap,
      revoked: view.revoked,
      noise: view.noise,
      admitter: new Map([...view.admitter].filter(([key]) => view.governing.get(key) !== foundHash)),
      name: view.name,
    },
    revocations: revocationsOf(parsed, view),
    failClosed: [],
    local: localOf(file, view, self, live),
    pending: live.pending,
    peers: live.peers,
    lines: live.lines,
    budget: live.budget,
    witnessPool: (subject) => witnessFacts(file.records, view, self, subject, cache),
  };
}

/** This host's mesh status now, or undefined while it is in no mesh: the host's `meshStatus`. */
export function storedMeshStatus(store: MeshStore, identity: HostIdentity, hooks: MeshHooks): MeshStatus | undefined {
  const file = store.read();
  if (file === undefined) return undefined;
  const self = base64urlEncode(identity.sign.publicKey);
  const cache = new ViewCache();
  return meshStatus(meshSourcesOf(file, viewOf(file.records, cache), self, hooks.live(), cache), new Date());
}
