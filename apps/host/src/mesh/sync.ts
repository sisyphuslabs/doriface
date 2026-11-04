import { CloseCode } from "@doriface/crypto";
import { hashOf, MAX_RECORDS, type Signed } from "@doriface/mesh";
import { headsOf } from "../state/mesh-tx.ts";
import { countersOf, missingSince } from "./anti-entropy.ts";
import type { Clock } from "./clock.ts";
import { deadline } from "./deadline.ts";
import { type LineLink, type MeshLine, MeshLines, recordLines, SYNC_EXPECTS } from "./lines.ts";
import type { MergeResult } from "./merge.ts";

/** Section 5.1: a sync session closes after 60 s without a line. */
export const LINGER_MS = 60_000;

/**
 * A peer answers a hello with `done` (records first, when it holds any the hello's heads lack). After this host's
 * hello, 30 s without a `records` or `done` line from the peer is a protocol fault (4400): a slow answer that keeps
 * delivering is never cut, and an idle one cannot keep the session past the deadline.
 */
export const ANSWER_MS = 30_000;

/** A merge that threw (a counter behind, the state lock, mesh.json gone): this session ends, the host goes on. */
const INTERNAL_ERROR = 1011;

export interface SyncHost {
  readonly meshId: string;
  records(): readonly Signed[];
  merge(session: SyncSession, batch: readonly Signed[]): MergeResult;
  /** The peer said which heads it holds, and the highest `n` it holds of each signer (its `hello`). */
  heard(peer: string, heads: readonly string[], n: Readonly<Record<string, number>>): void;
  /** The peer's `done`: what it held for this host has arrived, so a claim its hello made is resolved. */
  answered(session: SyncSession): void;
  /** The peer owed a `done` past ANSWER_MS with no line of progress; the session closes 4400 right after. */
  overdue(session: SyncSession): void;
  ended(session: SyncSession): void;
}

/**
 * One sync session (section 5.2): both sides say their heads, each sends what the other's heads do not cover, in
 * lines of at most 256 KiB ending with `done`, and asks once per session (`want`) for the past of a dangling record.
 * After any change it sends what the peer is still missing, so an ack goes back on the session that brought the batch.
 * What it holds for the peer is bounded: past MAX_RECORDS records before `done`, or claimed heads, it closes 4400.
 */
export class SyncSession {
  readonly peer: string;
  readonly dialer: string;
  /** This host opened it to sweep or probe: what it merges here is owed onwards (section 5.3). */
  readonly sweeping: boolean;
  readonly #lines: MeshLines;
  readonly #host: SyncHost;
  readonly #clock: Clock;
  readonly #lingerMs: number;
  readonly #peerHeads = new Set<string>();
  /** Every head the peer's `hello` lines named: a mesh holds at most MAX_RECORDS records, so no more heads exist. */
  readonly #claimed = new Set<string>();
  readonly #sent = new Set<string>();
  readonly #wanted = new Set<string>();
  #incoming: Signed[] = [];
  #saidHello = false;
  #idle: () => void = () => undefined;
  #answerDue: (() => void) | undefined;
  #closed = false;

  constructor(
    ends: { readonly peer: string; readonly dialer: string; readonly sweeping: boolean },
    link: LineLink,
    host: SyncHost,
    clock: Clock,
    lingerMs = LINGER_MS,
  ) {
    this.peer = ends.peer;
    this.dialer = ends.dialer;
    this.sweeping = ends.sweeping;
    this.#lines = new MeshLines(link, SYNC_EXPECTS);
    this.#host = host;
    this.#clock = clock;
    this.#lingerMs = lingerMs;
    void this.#lines.ended.then(() => this.#ended());
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** With `waitForHello` (the inviter's side of a join's session), it speaks only once the peer said hello. */
  start(waitForHello = false): void {
    this.#touch();
    if (!waitForHello) this.#hello();
    this.#read();
  }

  /** Sends every stored record the peer's known heads do not cover and that this session has not sent yet. */
  flush(): void {
    if (this.#closed) return;
    const missing = this.#unsent();
    if (missing.length > 0) this.#sendRecords(missing);
  }

  close(code = 1000, reason = "sync done"): void {
    if (this.#closed) return;
    this.#lines.close(code, reason);
    this.#ended();
  }

  #read(): void {
    this.#lines.next().then(
      (line) => {
        try {
          this.#receive(line);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return this.close(INTERNAL_ERROR, `sync failed: ${reason}`.slice(0, 120));
        }
        return this.#read();
      },
      () => this.#ended(),
    );
  }

  #hello(): void {
    this.#saidHello = true;
    const records = this.#host.records();
    this.#send({ t: "hello", v: 2, mesh: this.#host.meshId, heads: headsOf(records), n: countersOf(records) });
    this.#owesAnswer();
  }

  #owesAnswer(): void {
    this.#answerDue ??= deadline(this.#clock, ANSWER_MS, () => {
      this.#answerDue = undefined;
      this.#host.overdue(this);
      this.close(CloseCode.CryptoFailure, "no done after hello");
    });
  }

  /** A `records` line while a `done` is owed: the answer is still arriving, so its 30 s start again. */
  #progress(): void {
    if (this.#answerDue === undefined) return;
    this.#answerDue();
    this.#answerDue = undefined;
    this.#owesAnswer();
  }

  #unsent(): readonly Signed[] {
    return missingSince(this.#host.records(), this.#peerHeads).filter((record) => !this.#sent.has(hashOf(record)));
  }

  #receive(line: MeshLine): void {
    if (this.#closed) return;
    this.#touch();
    switch (line.t) {
      case "hello":
        return this.#heard(line.mesh, line.heads, line.n);
      case "records":
        if (this.#incoming.length + line.records.length > MAX_RECORDS) {
          return this.close(CloseCode.CryptoFailure, `more than ${MAX_RECORDS} records before done`);
        }
        this.#incoming.push(...line.records);
        return this.#progress();
      case "want":
        return this.#answerWant(line.hashes);
      case "done":
        this.#answerDue?.();
        this.#answerDue = undefined;
        this.#merge();
        return this.#host.answered(this);
      case "refused":
        return this.close(1000, `the peer refused: ${line.reason}`);
      case "offer":
      case "card":
        return this.close(CloseCode.CryptoFailure, `a ${line.t} line on a sync session`);
      default: {
        const unknown: never = line;
        return unknown;
      }
    }
  }

  #heard(mesh: string, heads: readonly string[], n: Readonly<Record<string, number>>): void {
    if (mesh !== this.#host.meshId) {
      this.#lines.refuse(CloseCode.UnknownDevice, "a mesh stream from another mesh");
      return this.#ended();
    }
    for (const head of heads) this.#claimed.add(head);
    if (this.#claimed.size > MAX_RECORDS) {
      return this.close(CloseCode.CryptoFailure, `a peer claimed more than ${MAX_RECORDS} heads`);
    }
    for (const head of heads) this.#peerHeads.add(head);
    this.#host.heard(this.peer, heads, n);
    if (!this.#saidHello) this.#hello();
    this.#sendRecords(this.#unsent());
  }

  #merge(): void {
    const batch = this.#incoming;
    this.#incoming = [];
    if (batch.length === 0) return;
    const brought = batch.map(hashOf);
    for (const hash of brought) this.#peerHeads.add(hash);
    const result = this.#host.merge(this, batch);
    this.#forgetUnstored(brought);
    if (this.#closed) return;
    const want = result.wanted.filter((hash) => !this.#wanted.has(hash));
    for (const hash of want) this.#wanted.add(hash);
    if (want.length > 0) this.#send({ t: "want", hashes: want });
    if (result.added.length > 0) this.#hello();
  }

  /** The peer holds what it brought, but only stored hashes stay: refused ones would grow the set without bound. */
  #forgetUnstored(brought: readonly string[]): void {
    const stored = new Set(this.#host.records().map(hashOf));
    for (const hash of brought) if (!stored.has(hash) && !this.#claimed.has(hash)) this.#peerHeads.delete(hash);
  }

  /** Each stored record goes to the peer at most once per session, however often it is wanted. */
  #answerWant(hashes: readonly string[]): void {
    const wanted = new Set(hashes);
    const found = this.#host
      .records()
      .filter((record) => wanted.has(hashOf(record)) && !this.#sent.has(hashOf(record)));
    if (found.length > 0) this.#sendRecords(found);
  }

  #sendRecords(records: readonly Signed[]): void {
    for (const record of records) this.#sent.add(hashOf(record));
    for (const line of recordLines(records)) this.#send(line);
    this.#send({ t: "done", mesh: this.#host.meshId });
  }

  #send(line: MeshLine): void {
    if (this.#closed) return;
    this.#touch();
    try {
      this.#lines.send(line);
    } catch {
      this.#ended();
    }
  }

  #touch(): void {
    this.#idle();
    this.#idle = this.#clock.after(this.#lingerMs, () => this.close(1000, "idle"));
  }

  #ended(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#idle();
    this.#answerDue?.();
    this.#host.ended(this);
  }
}
