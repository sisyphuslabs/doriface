import type { ByteLink, Unsubscribe } from "@doriface/client";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAP_SCRIPT = join(import.meta.dir, "hc-tap.ts");

/** An `hc` that records each `hc connect`'s bytes in `dir`; it carries its own settings, since `hc --version` runs without the host's env. */
export function tappedHc(dir: string, realHc: string): string {
  mkdirSync(join(dir, "taps"), { recursive: true });
  const hc = join(dir, "hc-tap");
  const settings = `DORIFACE_REAL_HC='${realHc}' DORIFACE_TAP_DIR='${join(dir, "taps")}'`;
  writeFileSync(hc, `#!/bin/sh\n${settings} exec '${process.execPath}' '${TAP_SCRIPT}' "$@"\n`);
  chmodSync(hc, 0o755);
  return hc;
}

export interface Tap {
  readonly read: Uint8Array;
  readonly wrote: Uint8Array;
}

export function taps(dir: string): Tap[] {
  const folder = join(dir, "taps");
  const file = (name: string): Uint8Array => {
    try {
      return new Uint8Array(readFileSync(join(folder, name)));
    } catch {
      return new Uint8Array(0);
    }
  };
  const pids = new Set(readdirSync(folder).map((name) => name.split(".")[0] ?? ""));
  return [...pids].map((pid) => ({ read: file(`${pid}.in`), wrote: file(`${pid}.out`) }));
}

/** The tap of the connection that sent `sent`: the one whose input shares the longest prefix with it. */
export function tapFor(all: readonly Tap[], sent: Uint8Array): Tap | undefined {
  const shared = (read: Uint8Array): number => {
    let length = 0;
    while (length < read.byteLength && length < sent.byteLength && read[length] === sent[length]) length += 1;
    return length;
  };
  return all.toSorted((a, b) => shared(b.read) - shared(a.read))[0];
}

/** Where two byte strings first differ, with a little context from each; undefined when equal. */
export function firstDifference(expected: Uint8Array, actual: Uint8Array): string | undefined {
  const length = Math.min(expected.byteLength, actual.byteLength);
  let offset = 0;
  while (offset < length && expected[offset] === actual[offset]) offset += 1;
  if (offset === length && expected.byteLength === actual.byteLength) return undefined;
  const around = (bytes: Uint8Array): string =>
    JSON.stringify(new TextDecoder().decode(bytes.subarray(Math.max(0, offset - 24), offset + 24)));
  return `byte ${offset} of ${expected.byteLength}/${actual.byteLength}: expected ${around(expected)}, got ${around(actual)}`;
}

/** A ByteLink that keeps every byte sent and received, captured from the first byte on. */
export class RecordingLink implements ByteLink {
  readonly #link: ByteLink;
  readonly #sent: Uint8Array[] = [];
  readonly #received: Uint8Array[] = [];
  readonly #listeners = new Set<(bytes: Uint8Array) => void>();

  constructor(link: ByteLink) {
    this.#link = link;
    link.onData((bytes) => {
      this.#received.push(bytes.slice());
      for (const listener of this.#listeners) listener(bytes);
    });
  }

  get sent(): Uint8Array {
    return concat(this.#sent);
  }

  get received(): Uint8Array {
    return concat(this.#received);
  }

  send(bytes: Uint8Array): void {
    this.#sent.push(bytes.slice());
    this.#link.send(bytes);
  }

  onData(listener: (bytes: Uint8Array) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener: (error: Error | undefined) => void): Unsubscribe {
    return this.#link.onClose(listener);
  }

  close(): void {
    this.#link.close();
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
