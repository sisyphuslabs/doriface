import { freshId } from "@doriface/protocol/layout";

export interface SplitLink {
  readonly pane: string;
  /** Runs once every earlier split in the tab has landed, with the pane this one comes off. */
  readonly place: (apply: (from: string) => void) => void;
  /** Its terminal did not start: a later split comes off the pane this one would have split. */
  readonly fail: () => void;
}

/**
 * Split keys pressed while an earlier split's terminal is still starting apply in key order, each to the pane the
 * split before it makes, as Ghostty applies the second key to the pane the first made. Without it the second key
 * splits whatever pane had focus when it was pressed, and the tree's shape depends on which terminal starts first.
 */
export class SplitChain {
  /** Per tab, the pane the last split in flight hands to the next: its own new pane, or its source if it failed. */
  readonly #handoff = new Map<string, Promise<string>>();

  /** `source` is the pane named for this split; null splits the focused pane, or the one an earlier split makes. */
  next(tab: string, focused: string, source: string | null): SplitLink {
    const before = this.#handoff.get(tab);
    const from: Promise<string> =
      before === undefined ? Promise.resolve(source ?? focused) : before.then((handed) => source ?? handed);
    const pane = freshId("p");
    const { promise, resolve } = Promise.withResolvers<string>();
    this.#handoff.set(tab, promise);
    const settle = (handed: string): void => {
      resolve(handed);
      if (this.#handoff.get(tab) === promise) this.#handoff.delete(tab);
    };
    return {
      pane,
      place: (apply) =>
        void from.then((at) => {
          apply(at);
          settle(pane);
          return at;
        }),
      fail: () => void from.then(settle),
    };
  }
}

/** One split as the workspace asks for it: the tab, the pane in focus there, and the pane named for it (or null). */
export interface SplitRequest {
  readonly tab: string;
  readonly focused: string;
  readonly source: string | null;
}

/**
 * Starts a split's terminal (`start`, which calls back with its address or that it failed) and places it, once every
 * earlier split in the tab has landed, off the pane the one before it makes (`split`: address, pane it comes off, and
 * the new pane's id).
 */
export function chainedSplit(
  chain: SplitChain,
  request: SplitRequest,
  start: (place: (address: string) => void, fail: () => void) => void,
  split: (address: string, from: string, made: string) => void,
): void {
  const link = chain.next(request.tab, request.focused, request.source);
  start((address) => link.place((from) => split(address, from, link.pane)), link.fail);
}
