import { CloseCode, generateX25519 } from "@doriface/crypto";
import { memoryLinkPair, type MemoryEnd } from "@doriface/crypto/testing";
import { MAX_MESH_MEMBERS, parseRecord, type Signed, signCard } from "@doriface/mesh";
import { rmSync } from "node:fs";
import { join } from "node:path";
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
import { cardFor, machine, signPubOf } from "../testing/mesh-history.ts";
import { serveJoin } from "./invite.ts";
import { INVITER_EXPECTS, JOINER_EXPECTS, type MeshLine, MeshLines } from "./lines.ts";
import { PendingJoins } from "./pending-joins.ts";

afterEach(removeSides);

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const types = (s: Side): readonly (string | undefined)[] =>
  (s.mesh.read()?.records ?? []).map((record: Signed) => parseRecord(record)?.type);
const autoJoins = (): PendingJoins => {
  const pending = new PendingJoins();
  pending.setAuto(Date.now() + 60_000);
  return pending;
};
const joined = async (inviter: Side, joiner: Side): Promise<void> => {
  await runJoin(inviteDeps(inviter, autoJoins()), joinerContext(joiner, inviter), joiner.m.identity.noise.publicKey)
    .joined;
};

/** Serves a join to a hand-driven joiner: `answer` gets the offer and the joiner's end of the link. */
async function serveTo(a: Side, pending: PendingJoins, answer: (offer: MeshLine, end: MemoryEnd, b: Side) => void) {
  const b = side("beta");
  const [inviterEnd, joinerEnd] = memoryLinkPair();
  const invited = failure(
    serveJoin(new MeshLines(inviterEnd, INVITER_EXPECTS), b.m.identity.noise.publicKey, inviteDeps(a, pending)),
  );
  answer(await new MeshLines(joinerEnd, JOINER_EXPECTS).next(), joinerEnd, b);
  return { b, inviterEnd, invited };
}
const cardLine = (card: Signed): string => `${JSON.stringify({ t: "card", ...card })}\n`;

describe("section 4.4 step 3: a member re-joins through any member", () => {
  test("a member whose welcome was lost re-joins through a member that did not admit it", async () => {
    const [a, b, c] = [side("alpha"), side("beta"), side("gamma")];
    await joined(a, b);
    await joined(a, c);
    rmSync(join(b.dir, "mesh.json"));
    const before = types(c);
    const run = runJoin(inviteDeps(c, new PendingJoins()), joinerContext(b, c), b.m.identity.noise.publicKey);
    expect(await run.joined).toBe(c.mesh.read()?.meshId ?? "");
    expect(types(c)).toEqual(before);
    expect(b.mesh.read()?.records).toEqual(c.mesh.read()?.records);
  });

  test("a member whose admitter left the mesh re-joins through another member", async () => {
    const [a, b, c] = [side("alpha"), side("beta"), side("gamma")];
    await joined(a, b);
    await joined(a, c);
    const meshId = a.mesh.read()?.meshId ?? "";
    const leave = { signPubs: [signPubOf(a.m)], reason: "leave" } as const;
    a.mesh.sign(a.m.identity, (n, prev) => ({
      v: 2,
      mesh: meshId,
      type: "revoke",
      by: signPubOf(a.m),
      n,
      prev,
      subject: leave,
    }));
    c.mesh.merge(a.mesh.read()?.records ?? []);
    rmSync(join(b.dir, "mesh.json"));
    const run = runJoin(inviteDeps(c, new PendingJoins()), joinerContext(b, c), b.m.identity.noise.publicKey);
    expect(await run.joined).toBe(meshId);
    expect(b.mesh.authorizeIndex()?.isMember(signPubOf(a.m))).toBe(false);
  });

  test("a member whose Noise key is not its key in the mesh gets no welcome and is not asked about", async () => {
    const [a, b] = [side("alpha"), side("beta")];
    await joined(a, b);
    rmSync(join(b.dir, "mesh.json"));
    const identity = { ...b.m.identity, noise: generateX25519() };
    const pending = new PendingJoins();
    const run = runJoin(inviteDeps(a, pending), { ...joinerContext(b, a), identity }, identity.noise.publicKey);
    expect(await failure(run.invited)).toContain("this host is a member with another Noise key");
    expect(run.inviterEnd.sent.some((bytes) => new TextDecoder().decode(bytes).startsWith('{"t":"records"'))).toBe(
      false,
    );
    expect(pending.list()).toEqual([]);
  });
});

describe("the inviter checks the card before the owner is asked (section 4.4 step 3)", () => {
  test("a card replayed from another offer is refused, and the owner is never asked", async () => {
    const a = side("alpha");
    const pending = new PendingJoins();
    const { invited } = await serveTo(a, pending, (offer, end, b) => {
      if (offer.t !== "offer") throw new Error("no offer");
      const replayed = cardBody(
        b.m.identity,
        { name: "beta", hcId: "core" },
        offer.mesh,
        offer.inviter,
        "AAAAAAAAAAAAAAAAAAAAAA",
      );
      end.send(encode(cardLine(signCard(replayed, b.m.identity.sign.secretKey))));
    });
    expect(await invited).toBe("the card is not for this offer");
    expect(pending.list()).toEqual([]);
  });

  test("a card whose signature does not verify is refused, and the owner is never asked", async () => {
    const a = side("alpha");
    const pending = new PendingJoins();
    const { invited } = await serveTo(a, pending, (offer, end, b) => {
      if (offer.t !== "offer") throw new Error("no offer");
      const card = signCard(
        cardBody(b.m.identity, { name: "beta", hcId: "core" }, offer.mesh, offer.inviter, offer.nonce),
        machine("other").identity.sign.secretKey,
      );
      end.send(encode(cardLine(card)));
    });
    expect(await invited).toBe("the card does not verify");
    expect(pending.list()).toEqual([]);
  });

  test("a mesh that is already full refuses before the owner is asked", async () => {
    const a = side("alpha");
    a.mesh.found(a.m.identity, ownOf(a));
    const meshId = a.mesh.read()?.meshId ?? "";
    for (let i = 1; i < MAX_MESH_MEMBERS; i++) {
      const card = cardFor(machine(`member${i}`), meshId, a.m);
      a.mesh.sign(a.m.identity, (n, prev) => ({
        v: 2,
        mesh: meshId,
        type: "admit",
        by: signPubOf(a.m),
        n,
        prev,
        subject: { card },
      }));
    }
    const pending = new PendingJoins();
    const b = side("beta");
    const run = runJoin(inviteDeps(a, pending), joinerContext(b, a), b.m.identity.noise.publicKey);
    expect(await failure(run.invited)).toBe("the mesh is full");
    expect(pending.list()).toEqual([]);
  });
});

describe("a session that ends during approval admits nothing", () => {
  test.each([
    ["the owner's approval", false],
    ["--auto", true],
  ])("a second card in the card's chunk closes 4400 and writes no admit, with %s", async (_, auto) => {
    const a = side("alpha");
    const pending = auto ? autoJoins() : new PendingJoins();
    const { inviterEnd, invited } = await serveTo(a, pending, (offer, end, b) => {
      if (offer.t !== "offer") throw new Error("no offer");
      const card = signCard(
        cardBody(b.m.identity, { name: "beta", hcId: "core" }, offer.mesh, offer.inviter, offer.nonce),
        b.m.identity.sign.secretKey,
      );
      end.send(encode(cardLine(card).repeat(2)));
    });
    expect(await invited).toContain("unexpected card line");
    expect(inviterEnd.closeCode).toBe(CloseCode.CryptoFailure);
    expect(types(a)).toEqual(["found"]);
    expect(pending.list()).toEqual([]);
  });

  test("a joiner that gives up during approval is refused with 4401, and the pending join is dropped", async () => {
    const [a, b] = [side("alpha"), side("beta")];
    const pending = new PendingJoins();
    const run = runJoin(inviteDeps(a, pending), joinerContext(b, a), b.m.identity.noise.publicKey);
    await pending.next();
    run.joinerEnd.send(encode('{"t":"refused","reason":"the user gave up"}\n'));
    expect(await failure(run.invited)).toBe("the joiner gave up: the user gave up");
    expect(run.inviterEnd.closeCode).toBe(CloseCode.UnknownDevice);
    expect(pending.list()).toEqual([]);
  });
});
