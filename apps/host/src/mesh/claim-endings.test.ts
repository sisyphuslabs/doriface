import { describe, expect, test } from "bun:test";
import { CloseCode } from "@doriface/crypto";
import { memoryLinkPair } from "@doriface/crypto/testing";
import { hashOf, parseRecord, type Signed } from "@doriface/mesh";
import { CounterBehindError } from "../state/mesh.ts";
import type { MeshLine } from "./lines.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { headsOfRecords, meshOf, peer, Signer } from "./testing/mesh-peers.ts";
import { MeshNet } from "./testing/mesh-net.ts";

const [a, b, c] = [peer("a"), peer("b"), peer("c")];
const revoke = { type: "revoke", signPubs: [c.signPub], reason: "revoke" } as const;
const encode = (line: MeshLine): Uint8Array => new TextEncoder().encode(`${JSON.stringify(line)}\n`);
const CLAIM = { [b.signPub]: Number.MAX_SAFE_INTEGER };

/** b holding `records`; `connect()` opens a sync session a dialed to b, and the test speaks for a on it. */
function atB(records: readonly Signed[], seed: number) {
  const clock = new FakeClock();
  const host = new MeshNet(clock, seededRandom(seed)).add(b, records);
  const mesh = host.gossip.meshId;
  const connect = (heads = headsOfRecords(records)) => {
    const [ours, theirs] = memoryLinkPair(true);
    host.gossip.attach(a.signPub, a.signPub, ours);
    const say = (line: MeshLine): void => theirs.send(encode(line));
    return {
      ours,
      theirs,
      say,
      hello: (n: Readonly<Record<string, number>>) => say({ t: "hello", v: 2, mesh, heads, n }),
    };
  };
  const signs = (): boolean => {
    try {
      host.gossip.append(revoke);
      return true;
    } catch (error) {
      if (error instanceof CounterBehindError) return false;
      throw error;
    }
  };
  const ownNs = (): readonly number[] =>
    (host.store.read()?.records ?? []).flatMap((record) => {
      const body = parseRecord(record);
      return body?.by === b.signPub ? [body.n] : [];
    });
  const at = async (ms: number): Promise<void> => clock.advance(ms - clock.now());
  return { clock, mesh, connect, signs, ownNs, at };
}

type Host = ReturnType<typeof atB>;
type Session = ReturnType<Host["connect"]>;
const redial = (s: Host): Session => {
  const next = s.connect();
  next.hello(CLAIM);
  return next;
};
/** What the claimer does every `everyMs`, starting `everyMs` after its first claim; returns the session it goes on with. */
const tactics: readonly [string, number, (s: Host, session: Session, stored: Signed) => Session][] = [
  [
    "closes its session and redials",
    25_000,
    (s, session) => {
      session.theirs.close(1000, "bye");
      return redial(s);
    },
  ],
  ["redials, the new session replacing the old", 25_000, (s) => redial(s)],
  [
    "sends a malformed line and redials",
    25_000,
    (s, session) => {
      session.theirs.send(new TextEncoder().encode("not json\n"));
      return redial(s);
    },
  ],
  [
    "loses its transport and redials",
    25_000,
    (s, session) => {
      session.theirs.close(1006, "");
      return redial(s);
    },
  ],
  [
    "sends an empty done, then the same claim again",
    25_000,
    (s, session) => {
      session.say({ t: "done", mesh: s.mesh });
      session.hello(CLAIM);
      return session;
    },
  ],
  [
    "trickles a record this host already holds",
    25_000,
    (_s, session, stored) => {
      session.say({ t: "records", records: [stored] });
      return session;
    },
  ],
  [
    "keeps the session busy with empty records lines",
    10_000,
    (_s, session) => {
      session.say({ t: "records", records: [] });
      session.hello(CLAIM);
      return session;
    },
  ],
];

describe("no renewal tactic holds a claim past 30 s in 10 minutes (section 10.1)", () => {
  test.each(tactics)("a claimer that %s", async (_how, everyMs, act) => {
    const { records } = meshOf([a, b, c]);
    const [stored] = records;
    if (stored === undefined) throw new Error("no records");
    const s = atB(records, 91);
    let session = s.connect();
    session.hello(CLAIM);
    const samples = new Map([
      [24_000, false],
      [31_000, true],
      [300_000, true],
      [590_000, true],
    ]);
    const times = [
      ...new Set([
        ...samples.keys(),
        ...Array.from({ length: Math.floor(600_000 / everyMs) }, (_, i) => (i + 1) * everyMs),
      ]),
    ].toSorted((x, y) => x - y);
    const seen: boolean[] = [];
    const step = async ([time, ...rest]: readonly number[]): Promise<void> => {
      if (time === undefined) return;
      await s.at(time);
      if (samples.has(time)) seen.push(s.signs());
      // A session this host closed (4400 for owing its done) is simply dialed again: that is the claimer's tactic too.
      if (session.ours.closeCode !== undefined) session = redial(s);
      if (time % everyMs === 0) session = act(s, session, stored);
      return step(rest);
    };
    await step(times);
    expect(seen).toEqual([...samples.values()]);
  });

  test("an empty records line is no progress: the session closes 4400 at 30 s", async () => {
    const s = atB(meshOf([a, b, c]).records, 93);
    const session = s.connect();
    session.hello(CLAIM);
    await s.at(10_000);
    session.say({ t: "records", records: [] });
    await s.at(20_000);
    session.say({ t: "records", records: [] });
    await s.at(30_001);
    expect(session.ours.closeCode).toBe(CloseCode.CryptoFailure);
  });
});

/** b restored from a backup taken before its own ack: a holds b's counter 1, and the records that ack names. */
function restored() {
  const { records } = meshOf([a, b, c]);
  const one = new Signer(a, records).name(headsOfRecords(records), "a2");
  const two = new Signer(a, [...records, one]).admit(peer("d"), [hashOf(one)]);
  const own = new Signer(b, records).ack([hashOf(two)]);
  return { records, answer: [one, two, own], heads: [hashOf(own)] };
}

describe("an honest restored host (section 10.1)", () => {
  test("refuses its own records until the claimed ones arrive, however slowly, then signs past them: no fork", async () => {
    const { records, answer, heads } = restored();
    const s = atB(records, 94);
    const session = s.connect(heads);
    session.hello({ [b.signPub]: 1 });
    const refused: boolean[] = [];
    await s.at(1);
    refused.push(!s.signs());
    await s.at(29_000);
    refused.push(!s.signs());
    session.say({ t: "records", records: answer });
    await s.at(29_001);
    expect(refused).toEqual([true, true]);
    expect(s.signs()).toBe(true);
    await s.at(46_000);
    session.say({ t: "done", mesh: s.mesh });
    await s.at(46_001);
    expect(s.ownNs()).toEqual([1, 2]);
  });

  test("whose claimer's link drops and redials: the claim outlives the session, so it still does not fork", async () => {
    const { records, answer, heads } = restored();
    const s = atB(records, 95);
    const first = s.connect(heads);
    first.hello({ [b.signPub]: 1 });
    await s.at(20_000);
    first.theirs.close(1006, "");
    await s.at(21_000);
    expect(s.signs()).toBe(false);
    const second = s.connect(heads);
    second.hello({ [b.signPub]: 1 });
    second.say({ t: "records", records: answer });
    second.say({ t: "done", mesh: s.mesh });
    await s.at(22_000);
    expect(s.signs()).toBe(true);
    expect(s.ownNs()).toEqual([1, 2]);
  });
});

describe("an answer sends the hello's sender its own records first (section 10.1)", () => {
  test("in lines of their own, with their past, ahead of the rest", async () => {
    const { records } = meshOf([a, b, c]);
    const x = new Signer(c, records).name(headsOfRecords(records), "c2");
    const y = new Signer(a, [...records, x]).name([hashOf(x)], "a2");
    const z = new Signer(c, [...records, x, y]).name([hashOf(y)], "c3");
    const s = atB([...records, x, y, z], 96);
    const session = s.connect(headsOfRecords(records));
    session.hello({});
    await s.at(1);
    const text = session.ours.sent.map((bytes) => new TextDecoder().decode(bytes)).join("");
    const lines = text
      .split("\n")
      .filter((raw) => raw.length > 0)
      .map((raw): MeshLine => JSON.parse(raw));
    const batches = lines.flatMap((line) => (line.t === "records" ? [line.records.map(hashOf)] : []));
    expect(batches[0]).toEqual([x, y].map(hashOf));
    expect(batches[1]).toContain(hashOf(z));
  });
});
