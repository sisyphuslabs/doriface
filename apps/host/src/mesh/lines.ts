import { CloseCode, type Unsubscribe } from "@doriface/crypto";
import type { Signed } from "@doriface/mesh";

/** Section 5.2: every mesh stream line is at most 256 KiB, LF included. */
export const MAX_LINE_BYTES = 256 * 1024;

export type MeshLine =
  | { readonly t: "offer"; readonly mesh: string; readonly inviter: string; readonly nonce: string }
  | { readonly t: "card"; readonly body: string; readonly sig: string }
  | { readonly t: "records"; readonly records: readonly Signed[] }
  | { readonly t: "done"; readonly mesh: string }
  | { readonly t: "refused"; readonly reason: string };

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
const strings = (value: Readonly<Record<string, unknown>>, ...keys: string[]): boolean =>
  keys.every((key) => typeof value[key] === "string");
const isSigned = (value: unknown): value is Signed => isObject(value) && strings(value, "body", "sig");

/** A known line, `"unknown"` for a `t` this host does not know (ignored), or undefined when malformed. */
function parseLine(text: string): MeshLine | "unknown" | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value) || typeof value["t"] !== "string") return undefined;
  const line = value as MeshLine;
  switch (line.t) {
    case "offer":
      return strings(value, "mesh", "inviter", "nonce") ? line : undefined;
    case "card":
      return strings(value, "body", "sig") ? line : undefined;
    case "records": {
      const records = value["records"];
      return Array.isArray(records) && records.every(isSigned) ? line : undefined;
    }
    case "done":
      return strings(value, "mesh") ? line : undefined;
    case "refused":
      return strings(value, "reason") ? line : undefined;
    default:
      return "unknown";
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
 * 4400; a line of an unknown type is skipped. `next` rejects once the session closed with nothing left to read.
 */
export class MeshLines {
  readonly #link: LineLink;
  readonly #queue: MeshLine[] = [];
  readonly #waiters: PromiseWithResolvers<MeshLine>[] = [];
  #buffer = "";
  #closed: Error | undefined;

  constructor(link: LineLink) {
    this.#link = link;
    const decoder = new TextDecoder();
    link.onData((bytes) => this.#receive(decoder.decode(bytes, { stream: true })));
    link.onClose((error) => this.#end(error ?? new Error("the session closed")));
  }

  send(line: MeshLine): void {
    const bytes = encoder.encode(`${JSON.stringify(line)}\n`);
    if (bytes.byteLength > MAX_LINE_BYTES) throw new Error("a mesh line exceeds 256 KiB");
    this.#link.send(bytes);
  }

  next(): Promise<MeshLine> {
    const line = this.#queue.shift();
    if (line !== undefined) return Promise.resolve(line);
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

  #receive(text: string): void {
    this.#buffer += text;
    for (let end = this.#buffer.indexOf("\n"); end !== -1; end = this.#buffer.indexOf("\n")) {
      const raw = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      const line = encoder.encode(raw).byteLength < MAX_LINE_BYTES ? parseLine(raw) : undefined;
      if (line === undefined) return this.close(CloseCode.CryptoFailure, "malformed mesh line");
      if (line !== "unknown") this.#deliver(line);
    }
    if (encoder.encode(this.#buffer).byteLength >= MAX_LINE_BYTES) {
      this.close(CloseCode.CryptoFailure, "a mesh line exceeds 256 KiB");
    }
  }

  #deliver(line: MeshLine): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#queue.push(line);
    else waiter.resolve(line);
  }

  #end(error: Error): void {
    if (this.#closed !== undefined) return;
    this.#closed = error;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}
