import { memoryLinkPair, type MemoryEnd } from "@doriface/crypto/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InviteDeps, serveJoin } from "../mesh/invite.ts";
import { type JoinerContext, runJoiner } from "../mesh/join.ts";
import { INVITER_EXPECTS, JOINER_EXPECTS, MeshLines } from "../mesh/lines.ts";
import { PendingJoins } from "../mesh/pending-joins.ts";
import { MeshStore } from "../state/mesh.ts";
import { type Machine, machine } from "./mesh-history.ts";

/** One side of a join: a machine with its own state dir and mesh store, and what it logged. */
export interface Side {
  readonly m: Machine;
  readonly dir: string;
  readonly mesh: MeshStore;
  readonly logs: string[];
}

const dirs: string[] = [];

export function side(name: string): Side {
  const dir = mkdtempSync(join(tmpdir(), `dh-join-${name}-`));
  dirs.push(dir);
  const logs: string[] = [];
  return { m: machine(name), dir, logs, mesh: new MeshStore(dir, { log: (line) => void logs.push(line) }) };
}

export function removeSides(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const ownOf = (s: Side) => ({ name: s.m.name, hcId: s.m.hcId });

export function inviteDeps(inviter: Side, pending = new PendingJoins(), expiresAt = Date.now() + 60_000): InviteDeps {
  const log = (line: string): void => void inviter.logs.push(line);
  return { identity: inviter.m.identity, mesh: inviter.mesh, pending, own: async () => ownOf(inviter), expiresAt, log };
}

export function joinerContext(
  joiner: Side,
  inviter: Side,
  dialedNoise = inviter.m.identity.noise.publicKey,
): JoinerContext {
  const log = (line: string): void => void joiner.logs.push(line);
  const dialed = { hostId: inviter.m.identity.hostId, noisePub: dialedNoise };
  const deadline = Date.now() + 60_000;
  return { identity: joiner.m.identity, mesh: joiner.mesh, own: ownOf(joiner), dialed, deadline, log };
}

export interface JoinRun {
  readonly inviterEnd: MemoryEnd;
  readonly joinerEnd: MemoryEnd;
  readonly invited: Promise<unknown>;
  readonly joined: Promise<string>;
}

/** Runs both sides of a join over an in-memory link (no Noise: the protocol is what is under test). */
export function runJoin(deps: InviteDeps, ctx: JoinerContext, joinerNoise: Uint8Array): JoinRun {
  const [inviterEnd, joinerEnd] = memoryLinkPair();
  const invited = serveJoin(new MeshLines(inviterEnd, INVITER_EXPECTS), joinerNoise, deps);
  const joined = runJoiner(new MeshLines(joinerEnd, JOINER_EXPECTS), ctx);
  invited.catch(() => undefined);
  joined.catch(() => undefined);
  return { inviterEnd, joinerEnd, invited, joined };
}

export const failure = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
