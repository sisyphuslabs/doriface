import { MAX_MESH_MEMBERS, parseRecord, type Signed, signCard } from "@doriface/mesh";
import { afterEach, describe, expect, test } from "bun:test";
import { cardBody } from "../state/mesh.ts";
import {
  failure,
  inviteDeps,
  joinerContext,
  ownOf,
  removeSides,
  runJoin,
  side,
  type Side,
} from "../testing/join-harness.ts";
import { machine, signPubOf } from "../testing/mesh-history.ts";
import { PendingJoins } from "./pending-joins.ts";

afterEach(removeSides);

const records = (s: Side): readonly Signed[] => s.mesh.read()?.records ?? [];
const types = (s: Side): readonly (string | undefined)[] => records(s).map((record) => parseRecord(record)?.type);
const autoJoins = (): PendingJoins => {
  const pending = new PendingJoins();
  pending.setAuto(Date.now() + 60_000);
  return pending;
};
const isWelcome = (bytes: Uint8Array): boolean => /^\{"t":"(records|done)"/.test(new TextDecoder().decode(bytes));

describe("section 4.4 step 3: a member whose welcome was lost joins again", () => {
  test("the retry is welcomed without a second admit, and both mesh.json files hold the same records", async () => {
    const [a, b] = [side("alpha"), side("beta")];
    const lost = runJoin(inviteDeps(a, autoJoins()), joinerContext(b, a), b.m.identity.noise.publicKey);
    lost.inviterEnd.tap = (bytes) => (isWelcome(bytes) ? [] : [bytes]);
    await lost.invited;
    lost.inviterEnd.close(1001, "the relay dropped the session");
    expect(await failure(lost.joined)).not.toBe("resolved");
    expect(b.mesh.read()).toBeUndefined();
    expect(types(a)).toEqual(["found", "admit"]);

    const retry = runJoin(inviteDeps(a, new PendingJoins()), joinerContext(b, a), b.m.identity.noise.publicKey);
    expect(await retry.joined).toBe(a.mesh.read()?.meshId ?? "");
    expect(types(a)).toEqual(["found", "admit"]);
    expect(records(b)).toEqual(records(a));
    expect([retry.inviterEnd.closeCode, retry.joinerEnd.closeCode]).toEqual([undefined, undefined]);
  });

  test("a joiner admitted another way while its join waited for approval gets the welcome, not a second admit", async () => {
    const [a, b] = [side("alpha"), side("beta")];
    a.mesh.found(a.m.identity, ownOf(a));
    const meshId = a.mesh.read()?.meshId ?? "";
    const pending = new PendingJoins();
    const run = runJoin(inviteDeps(a, pending), joinerContext(b, a), b.m.identity.noise.publicKey);
    const asked = await pending.next();
    const earlier = signCard(cardBody(b.m.identity, ownOf(b), meshId, signPubOf(a.m)), b.m.identity.sign.secretKey);
    a.mesh.sign(a.m.identity, (n, prev) => ({
      v: 2,
      mesh: meshId,
      type: "admit",
      by: signPubOf(a.m),
      n,
      prev,
      subject: { card: earlier },
    }));
    pending.decide(asked.nonce, true);
    expect(await run.joined).toBe(meshId);
    expect(types(a)).toEqual(["found", "admit"]);
    expect(records(b)).toEqual(records(a));
  });

  test("a mesh that filled up while a join waited for approval refuses it and writes no admit", async () => {
    const [a, b] = [side("alpha"), side("beta")];
    a.mesh.found(a.m.identity, ownOf(a));
    const meshId = a.mesh.read()?.meshId ?? "";
    const admitMachine = (name: string): void => {
      const other = machine(name);
      const card = signCard(
        cardBody(other.identity, { name, hcId: `core-${name}` }, meshId, signPubOf(a.m)),
        other.identity.sign.secretKey,
      );
      a.mesh.sign(a.m.identity, (n, prev) => ({
        v: 2,
        mesh: meshId,
        type: "admit",
        by: signPubOf(a.m),
        n,
        prev,
        subject: { card },
      }));
    };
    for (let i = 2; i < MAX_MESH_MEMBERS; i++) admitMachine(`member${i}`);
    const pending = new PendingJoins();
    const run = runJoin(inviteDeps(a, pending), joinerContext(b, a), b.m.identity.noise.publicKey);
    const asked = await pending.next();
    admitMachine("last");
    pending.decide(asked.nonce, true);
    expect(await failure(run.invited)).toBe("the mesh is full");
    expect(types(a).filter((type) => type === "admit")).toHaveLength(MAX_MESH_MEMBERS - 1);
    expect(b.mesh.read()).toBeUndefined();
  });
});
