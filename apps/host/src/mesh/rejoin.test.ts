import { parseRecord, type Signed } from "@doriface/mesh";
import { afterEach, describe, expect, test } from "bun:test";
import { failure, inviteDeps, joinerContext, removeSides, runJoin, side, type Side } from "../testing/join-harness.ts";
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
});
