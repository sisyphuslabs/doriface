import { CloseCode, type Unsubscribe } from "@doriface/crypto";
import type { Signed } from "@doriface/mesh";

/** Section 5.2: every mesh stream line is at most 256 KiB, LF included. */
export const MAX_LINE_BYTES = 256 * 1024;
/** Unread lines a session holds before it closes with 4400: a reader takes each line on the next microtask. */
export const MAX_QUEUED_LINES = 256;
/** Unread bytes a session holds before it closes with 4400, the same bound the secure link keeps on its plaintext. */
export const MAX_QUEUED_BYTES = 4 * 1024 * 1024;

export type MeshLine =
  | { readonly t: "offer"; readonly mesh: string; readonly inviter: string; readonly nonce: string }
  | { readonly t: "card"; readonly body: string; readonly sig: string }
  | { readonly t: "records"; readonly records: readonly Signed[] }
  | { readonly t: "done"; readonly mesh: string }
  | { readonly t: "refused"; readonly reason: string };

export type LineType = MeshLine["t"];

/** What each side of a join reads first (section 4.4): the inviter a card, the joiner the offer; or a refusal. */
export const INVITER_EXPECTS: readonly LineType[] = ["card", "refused"];
export const JOINER_EXPECTS: readonly LineType[] = ["offer", "refused"];

/** The decrypted session as the mesh stream sees it. */
export interface LineLink {
  send(bytes: Uint8Array): void;
  onData(listener: (bytes: Uint8Array) => void): Unsubscribe;
  onClose(listener: (error: Error | undefined) => void): Unsubscribe;
  close(code?: number, reason?: string): void;
}

const encoder = new TextEncoder();
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringOf = (value: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};
const signedOf = (value: unknown): Signed | undefined => {
  if (!isObject(value)) return undefined;
  const [body, sig] = [stringOf(value, "body"), stringOf(value, "sig")];
  return body === undefined || sig === undefined ? undefined : { body, sig };
};

function recordsOf(value: unknown): Signed[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records: Signed[] = [];
  for (const item of value) {
    const record = signedOf(item);
    if (record === undefined) return undefined;
    records.push(record);
  }
  return records;
}

/** A known line, `"unknown"` for a `t` this host does not know (ignored), or undefined when malformed. */
function parseLine(text: string): MeshLine | "unknown" | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  const get = (key: string): string | undefined => stringOf(value, key);
  switch (value["t"]) {
    case "offer": {
      const [mesh, inviter, nonce] = [get("mesh"), get("inviter"), get("nonce")];
      return mesh === undefined || inviter === undefined || nonce === undefined
        ? undefined
        : { t: "offer", mesh, inviter, nonce };
    }
    case "card": {
      const card = signedOf(value);
      return card === undefined ? undefined : { t: "card", ...card };
    }
    case "records": {
      const records = recordsOf(value["records"]);
      return records === undefined ? undefined : { t: "records", records };
    }
    case "done": {
      const mesh = get("mesh");
      return mesh === undefined ? undefined : { t: "done", mesh };
    }
    case "refused": {
      const reason = get("reason");
      return reason === undefined ? undefined : { t: "refused", reason };
    }
    default:
      return typeof value["t"] === "string" ? "unknown" : undefined;
  }
}

/** The welcome's `records` lines: as many records per line as fit {@link MAX_LINE_BYTES}, in the given order. */
export function recordLines(records: readonly Signed[], maxBytes = MAX_LINE_BYTES): MeshLine[] {
  const frame = encoder.encode(`${JSON.stringify({ t: "records", records: [] })}\n`).byteLength;
  const lines: MeshLine[] = [];
  let batch: Signed[] = [];
  let bytes = frame;
  for (const record of records) {
    const recordBytes = encoder.encode(JSON.stringify(record)).byteLength;
    if (batch.length > 0 && bytes + 1 + recordBytes > maxBytes) {
      lines.push({ t: "records", records: batch });
      batch = [];
      bytes = frame;
    }
    bytes += (batch.length > 0 ? 1 : 0) + recordBytes;
    batch.push(record);
  }
  if (batch.length > 0) lines.push({ t: "records", records: batch });
  return lines;
}

/**
 * LF-terminated JSON lines over a session (section 10.2). A line over the limit or malformed closes the session with
 * 4400, and so does a known line the protocol state does not expect (see {@link expect}) and a reader that falls
 * {@link MAX_QUEUED_LINES} or {@link MAX_QUEUED_BYTES} behind; a line of an unknown type is skipped. `next` rejects
 * once the session closed with nothing left to read.
 */
export class MeshLines {
  /** Resolves with the reason once the session closed or the lines were detached. */
  readonly ended: Promise<Error>;
  readonly #link: LineLink;
  readonly #queue: { readonly line: MeshLine; readonly bytes: number }[] = [];
  readonly #waiters: PromiseWithResolvers<MeshLine>[] = [];
  readonly #ended = Promise.withResolvers<Error>();
  readonly #unsubscribe: readonly Unsubscribe[];
  #expected: ReadonlySet<LineType>;
  #queuedBytes = 0;
  #buffer = "";
  #closed: Error | undefined;

  constructor(link: LineLink, expected: readonly LineType[]) {
    this.ended = this.#ended.promise;
    this.#link = link;
    this.#expected = new Set(expected);
    const decoder = new TextDecoder();
    this.#unsubscribe = [
      link.onData((bytes) => this.#receive(decoder.decode(bytes, { stream: true }))),
      link.onClose((error) => this.#end(error ?? new Error("the session closed"))),
    ];
  }

  /** Why the lines ended (the session closed, or they were detached); undefined while they are open. */
  get closed(): Error | undefined {
    return this.#closed;
  }

  /** The line types the protocol state consumes from now on; any other known line closes the session with 4400. */
  expect(...types: LineType[]): void {
    this.#expected = new Set(types);
    const stray = this.#queue.find(({ line }) => !this.#expected.has(line.t));
    if (stray === undefined) return;
    this.#queue.length = 0;
    this.#queuedBytes = 0;
    this.#unexpected(stray.line.t);
  }

  send(line: MeshLine): void {
    const bytes = encoder.encode(`${JSON.stringify(line)}\n`);
    if (bytes.byteLength > MAX_LINE_BYTES) throw new Error("a mesh line exceeds 256 KiB");
    this.#link.send(bytes);
  }

  next(): Promise<MeshLine> {
    const queued = this.#queue.shift();
    if (queued !== undefined) {
      this.#queuedBytes -= queued.bytes;
      return Promise.resolve(queued.line);
    }
    if (this.#closed !== undefined) return Promise.reject(this.#closed);
    const waiter = Promise.withResolvers<MeshLine>();
    this.#waiters.push(waiter);
    return waiter.promise;
  }

  /** Tells the peer why with a `refused` line, if the session is still open, then closes it with `code`. */
  refuse(code: number, reason: string): void {
    if (this.#closed === undefined) this.send({ t: "refused", reason });
    this.close(code, reason);
  }

  close(code: number, reason: string): void {
    this.#link.close(code, reason);
    this.#end(new Error(reason));
  }

  /** The join is over: stops reading the session, which stays open for whoever serves it next. */
  detach(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.#end(new Error("the join is over"));
  }

  #receive(text: string): void {
    if (this.#closed !== undefined) return;
    this.#buffer += text;
    let start = 0;
    for (let end = this.#buffer.indexOf("\n"); end !== -1; end = this.#buffer.indexOf("\n", start)) {
      const raw = this.#buffer.slice(start, end);
      start = end + 1;
      const bytes = encoder.encode(raw).byteLength;
      const line = bytes < MAX_LINE_BYTES ? parseLine(raw) : undefined;
      if (line === undefined) return this.close(CloseCode.CryptoFailure, "malformed mesh line");
      if (line !== "unknown" && !this.#deliver(line, bytes)) return;
    }
    this.#buffer = this.#buffer.slice(start);
    if (encoder.encode(this.#buffer).byteLength >= MAX_LINE_BYTES) {
      this.close(CloseCode.CryptoFailure, "a mesh line exceeds 256 KiB");
    }
  }

  #deliver(line: MeshLine, bytes: number): boolean {
    if (!this.#expected.has(line.t)) return this.#unexpected(line.t);
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(line);
      return true;
    }
    if (this.#queue.length >= MAX_QUEUED_LINES || this.#queuedBytes + bytes > MAX_QUEUED_BYTES) {
      this.close(CloseCode.CryptoFailure, "too many unread mesh lines");
      return false;
    }
    this.#queue.push({ line, bytes });
    this.#queuedBytes += bytes;
    return true;
  }

  #unexpected(type: LineType): false {
    this.close(CloseCode.CryptoFailure, `unexpected ${type} line`);
    return false;
  }

  #end(error: Error): void {
    if (this.#closed !== undefined) return;
    this.#closed = error;
    this.#ended.resolve(error);
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}
