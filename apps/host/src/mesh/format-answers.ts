import type { FormatSupport } from "./format-readiness.ts";

/** Not a record on purpose: a capability written into the signed DAG is the very thing an older member cannot read. */
export class FormatAnswers {
  readonly #reads = new Map<string, readonly number[] | undefined>();

  record(hostId: string, reads: readonly number[] | undefined): void {
    this.#reads.set(hostId, reads);
  }

  all(): readonly FormatSupport[] {
    return [...this.#reads].map(([hostId, reads]) => ({ hostId, reads }));
  }
}
