import type { Clock } from "./clock.ts";
import type { Gossip } from "./gossip.ts";
import { IDLE_MESH_HOOKS, type MeshHooks } from "./host-hooks.ts";

/** The part of `HostSync` the mesh commands drive: its gossip once sync runs, starting it, and stopping it. */
export interface SyncHandle {
  readonly gossip: Gossip | undefined;
  changed(): void;
  stop(): void;
}

/** How often a confirmation wait looks at `owed()` again: confirmations arrive as the peers' next `hello`. */
const CONFIRM_STEP_MS = 250;

/**
 * The mesh commands' hooks on this host's sync (design 5.3 and 6.5). A record the store signed is pushed with
 * `gossip.stored`, which sends it on open sessions and dials every member still owed it. A member confirms once its
 * `hello` names heads that cover this host's records, which drops it out of `gossip.owed()`.
 */
export function syncHooks(sync: SyncHandle, clock: Clock): MeshHooks {
  const wait = (ms: number): Promise<void> => new Promise((resolve) => void clock.after(ms, resolve));
  return {
    push(records) {
      const running = sync.gossip;
      if (running !== undefined) return running.stored(records);
      sync.changed();
      sync.gossip?.stored(records);
    },
    async confirmations(withinMs) {
      const gossip = sync.gossip;
      if (gossip === undefined) return [];
      const owed = (): ReadonlySet<string> => new Set(gossip.owed().map((member) => member.signPub));
      const expected = [...owed()];
      const deadline = clock.now() + withinMs;
      const untilConfirmed = async (): Promise<void> => {
        if (!expected.some((key) => owed().has(key)) || clock.now() >= deadline) return;
        await wait(Math.min(CONFIRM_STEP_MS, deadline - clock.now()));
        return untilConfirmed();
      };
      await untilConfirmed();
      const still = owed();
      return expected.filter((key) => !still.has(key));
    },
    left: () => {
      sync.stop();
      return Promise.resolve();
    },
    live: IDLE_MESH_HOOKS.live,
  };
}
