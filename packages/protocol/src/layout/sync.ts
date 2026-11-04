import { type JsonObject, type JsonValue } from "../json.ts";
import { HcRpcError } from "../jsonrpc.ts";
import { readDocument } from "./document.ts";

export interface DocCalls {
  readonly get: (on: string | null) => Promise<{ readonly value: JsonValue; readonly version: number }>;
  readonly set: (on: string | null, value: JsonValue, version: number) => Promise<{ readonly version: number }>;
}

export type DocState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly doc: JsonObject | null; readonly version: number }
  | { readonly phase: "unreadable"; readonly reason: string; readonly version: number }
  | { readonly phase: "unavailable"; readonly reason: string };

/** An edit of the whole document: null when it no longer applies (its target went away), and nothing is written. */
export type DocEdit = (doc: JsonObject | null) => JsonObject | null;

const CONFLICT_RETRIES = 8;
const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const isConflict = (cause: unknown): boolean => cause instanceof HcRpcError && cause.kind === "conflict";

/**
 * One machine's herdr-app document, kept the way herdr-app keeps it (`src/mirror_sync.rs`): read with `doc.get`, every
 * write a compare-and-set at the version that was read, and a conflict re-reads the document and replaces ours with it.
 * Unlike herdr-app, which writes its whole model, doriface writes edits: after a conflict the person's edit is made
 * again on the fresh document, or dropped when it no longer applies. Writes go one at a time, in order.
 */
export class LayoutDoc {
  readonly #calls: DocCalls;
  readonly #on: string | null;
  readonly #changed: (state: DocState) => void;
  #state: DocState = { phase: "loading" };
  #reads = 0;
  #queue: Promise<unknown> = Promise.resolve();
  #writing = 0;
  /** The newest version a doc event named while our writes were in flight: read once they are done. */
  #missed = -1;

  constructor(calls: DocCalls, on: string | null, changed: (state: DocState) => void) {
    this.#calls = calls;
    this.#on = on;
    this.#changed = changed;
  }

  get state(): DocState {
    return this.#state;
  }

  #publish(state: DocState): void {
    this.#state = state;
    this.#changed(state);
  }

  /** Reads the document; a read that an edit or a later read overtook is not shown. */
  async refresh(): Promise<void> {
    const read = ++this.#reads;
    try {
      const { value, version } = await this.#calls.get(this.#on);
      if (read === this.#reads) this.#show(value, version);
    } catch (cause) {
      if (read === this.#reads) this.#publish({ phase: "unavailable", reason: reasonOf(cause) });
    }
  }

  #show(value: JsonValue, version: number): void {
    const read = readDocument(value);
    if (read.kind === "unreadable") this.#publish({ phase: "unreadable", reason: read.reason, version });
    else this.#publish({ phase: "ready", doc: read.kind === "ok" ? read.doc : null, version });
  }

  /**
   * A `doc` event: another client wrote the document, so read it unless this one wrote that version. While a write is
   * in flight the event can name a version past ours before our reply arrives; it is kept and read once writing ends.
   */
  heard(version: number): Promise<void> {
    if (version === this.#known()) return Promise.resolve();
    if (this.#writing === 0) return this.refresh();
    this.#missed = Math.max(this.#missed, version);
    return Promise.resolve();
  }

  #known(): number {
    return this.#state.phase === "ready" ? this.#state.version : -1;
  }

  /** Applies an edit and writes it; resolves false when it was dropped or the document cannot take writes. */
  edit(change: DocEdit): Promise<boolean> {
    const run = this.#queue.then(() => this.#write(change));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #write(change: DocEdit): Promise<boolean> {
    this.#writing += 1;
    try {
      return await this.#attempt(change, CONFLICT_RETRIES);
    } finally {
      this.#writing -= 1;
      const missed = this.#missed;
      if (this.#writing === 0 && missed !== -1) {
        this.#missed = -1;
        if (missed > this.#known()) await this.refresh();
      }
    }
  }

  async #attempt(change: DocEdit, left: number): Promise<boolean> {
    const state = this.#state;
    if (left === 0 || state.phase !== "ready") return false;
    const next = change(state.doc);
    if (next === null) return false;
    this.#reads += 1;
    this.#publish({ phase: "ready", doc: next, version: state.version });
    try {
      const { version } = await this.#calls.set(this.#on, next, state.version);
      this.#publish({ phase: "ready", doc: next, version });
      return true;
    } catch (cause) {
      const { value, version } = await this.#calls.get(this.#on);
      this.#show(value, version);
      if (!isConflict(cause)) throw cause;
    }
    return this.#attempt(change, left - 1);
  }
}
