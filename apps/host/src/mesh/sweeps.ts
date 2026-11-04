import { type Clock, type Random, uniform } from "./clock.ts";
import type { DialPolicy, DialPurpose } from "./dial-policy.ts";
import type { MemberEntry } from "./authorize-index.ts";

export interface SweepsOptions {
  readonly clock: Clock;
  readonly random: Random;
  readonly policy: DialPolicy;
  readonly timings: {
    readonly sweepAfterDownMs: number;
    readonly safetyNetMs: number;
    readonly safetyNetJitterMs: number;
  };
  /** The current members other than this host. */
  readonly members: () => readonly MemberEntry[];
  /** When this host last had a sync session with the member. */
  readonly lastSync: (signPub: string) => number | undefined;
  readonly sync: (member: MemberEntry, purpose: DialPurpose) => Promise<boolean>;
}

/**
 * Section 5.1's sweeps: after this host's own uplink was down for more than 2 minutes, it syncs with the member it
 * synced with most recently that answers; and every 10 minutes, give or take 2, with the online member it synced with
 * longest ago (the safety net).
 */
export class Sweeps {
  readonly #options: SweepsOptions;
  #stopNet: () => void = () => undefined;

  constructor(options: SweepsOptions) {
    this.#options = options;
  }

  start(): void {
    this.#armSafetyNet();
  }

  stop(): void {
    this.#stopNet();
  }

  uplinkReturned(downMs: number): void {
    const { clock, policy, members, timings } = this.#options;
    const others = members();
    policy.uplinkReturned(() => members().map((member) => member.signPub), clock.now() - downMs);
    if (downMs <= timings.sweepAfterDownMs) return;
    const recent = others.toSorted((a, b) => this.#last(b) - this.#last(a));
    void this.#sweep(recent);
  }

  #last(member: MemberEntry): number {
    return this.#options.lastSync(member.signPub) ?? -1;
  }

  async #sweep(candidates: readonly MemberEntry[]): Promise<void> {
    for (const member of candidates) if (await this.#options.sync(member, "sweep")) return;
  }

  #armSafetyNet(): void {
    const { clock, random, timings, policy, members } = this.#options;
    const { safetyNetMs, safetyNetJitterMs } = timings;
    const delay = uniform(random, safetyNetMs - safetyNetJitterMs, safetyNetMs + safetyNetJitterMs);
    this.#stopNet = clock.after(delay, () => {
      const online = members().filter((member) => policy.gate(member.signPub) === undefined);
      void this.#sweep(online.toSorted((a, b) => this.#last(a) - this.#last(b)).slice(0, 1));
      this.#armSafetyNet();
    });
  }
}
