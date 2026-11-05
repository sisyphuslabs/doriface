import { type ApprovalClock, CLAIM_TTL_MS, clockOf, FENCE_MARGIN_MS, holds } from "./approval-clock.ts";
import { promptStillThere, type ApprovalCore } from "./approval-live.ts";
import { type ApprovalMark, approvalKey } from "./approval-prompt.ts";
import {
  type Answerer,
  type ApprovalOutcome,
  type ApprovalRecord,
  readRecords,
  recordJson,
  update,
} from "./approval-records.ts";
import type { ApprovalAnswer } from "./approval-screen.ts";

export { approvalClock, CLAIM_TTL_MS, FENCE_MARGIN_MS, type ApprovalClock } from "./approval-clock.ts";
export { readApprovalRecord, type Answerer, type ApprovalOutcome, type ApprovalRecord } from "./approval-records.ts";

export type AnswerResult =
  | { readonly kind: "sent" }
  | { readonly kind: "stale" }
  /**
   * Nothing was pressed: the re-check failed, or the claim lapsed before the press; anyone may answer again. `attempt`
   * names this answer's claim, which the same client may pass as `retake` if the `failed` record could not be written.
   */
  | { readonly kind: "failed"; readonly reason: string; readonly attempt: string }
  /** The key press failed and may have reached the agent; the prompt stays held, so nobody presses again. */
  | { readonly kind: "unknown"; readonly reason: string }
  /** Another answer holds this prompt; its record says who and what. */
  | { readonly kind: "lost"; readonly record: ApprovalRecord };

const failure = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Sets the outcome of exactly this answer's record (prompt, client and attempt), never another answer's. */
async function settle(core: ApprovalCore, mark: ApprovalMark, mine: ApprovalRecord, outcome: ApprovalOutcome) {
  const ours = (record: ApprovalRecord) =>
    record.prompt === mine.prompt && record.client === mine.client && record.attempt === mine.attempt;
  await update(core, mark.terminal, (records) =>
    records.some(ours)
      ? records.map((record) => recordJson(record, ours(record) ? outcome : record.outcome))
      : undefined,
  );
}

/**
 * The claimer's fence, read right before its key press: the prompt's record is still this answer's own `claimed` one,
 * and both this client's own clocks (its monotonic clock and its wall clock, each read only against itself) say the
 * claim is younger than `CLAIM_TTL_MS - FENCE_MARGIN_MS`.
 */
async function fenced(
  core: ApprovalCore,
  address: string,
  mine: ApprovalRecord,
  clock: ApprovalClock,
  claimedAt: number,
  wall: () => number,
  wallClaimedAt: number,
) {
  const current = (await readRecords(core, address)).findLast((record) => record.prompt === mine.prompt);
  return (
    current?.client === mine.client &&
    current.attempt === mine.attempt &&
    current.outcome === "claimed" &&
    clock.now() - claimedAt < CLAIM_TTL_MS - FENCE_MARGIN_MS &&
    // A monotonic clock may stand still while the device sleeps; this device's own wall clock does not.
    wall() - wallClaimedAt < CLAIM_TTL_MS - FENCE_MARGIN_MS
  );
}

/**
 * Answer one prompt with one key press across every client.
 *
 * 1. Claim it in the terminal's approval document with a compare-and-set (`doc.set` at the version read). A record that
 *    holds the prompt (`claimed` and watched for less than CLAIM_TTL_MS on this client's own clock, or `sent`, `stale`,
 *    `unknown`) makes this answer lose. The only claim of its own a client takes over is the one it names by attempt id
 *    in `retake`, from an answer it saw end as `failed`.
 * 2. Re-read the live screen: press only if the marked prompt is still there.
 * 3. Fence: re-read the document; press only if the prompt's record is still this answer's own claim and this client's
 *    monotonic and wall clocks both say the claim is younger than CLAIM_TTL_MS - FENCE_MARGIN_MS (a sleeping page's
 *    monotonic clock may stand still). Otherwise nothing is pressed (`failed`).
 * 4. Press the agent's own key, then record `sent`. A press that throws is `unknown`: it may have landed, so the prompt
 *    stays held until the screen moves.
 *
 * `wallMs` is only shown to people. Two limits stay: a key already on the wire when its claim lapses, and someone
 * typing in the terminal itself; both need a conditional `terminal.keys` in hc (herdrdev/herdr-core#122).
 */
export interface AnswerOptions {
  /** This client's own clock; one per core by default. */
  readonly clock?: ApprovalClock;
  /** The attempt id of this client's own earlier `failed` answer, whose claim it may take over. */
  readonly retake?: string;
  /** This device's wall clock, read only against itself (default `Date.now`): it keeps running while a page sleeps. */
  readonly wall?: () => number;
}

export async function answerApproval(
  core: ApprovalCore,
  mark: ApprovalMark,
  answer: ApprovalAnswer,
  who: Answerer,
  wallMs: number,
  options: AnswerOptions = {},
): Promise<AnswerResult> {
  const clock = options.clock ?? clockOf(core);
  const key = approvalKey(mark);
  const claimedAt = clock.now();
  const wall = options.wall ?? Date.now;
  const wallClaimedAt = wall();
  const claim: ApprovalRecord = {
    prompt: key,
    answer,
    ...who,
    atMs: wallMs,
    attempt: crypto.randomUUID(),
    outcome: "claimed",
  };
  const taken = await update(core, mark.terminal, (records) =>
    records.some((record) => record.prompt === key && holds(record, clock, options.retake, who.client))
      ? undefined
      : [...records.filter((record) => record.prompt !== key), claim].map((record) => recordJson(record)),
  );
  const winner = taken?.findLast((record) => record.prompt === key);
  if (taken !== undefined) return winner === undefined ? { kind: "stale" } : { kind: "lost", record: winner };

  let press: boolean;
  try {
    if ((await promptStillThere(core, mark)) !== "pending") {
      await settle(core, mark, claim, "stale");
      return { kind: "stale" };
    }
    press = await fenced(core, mark.terminal, claim, clock, claimedAt, wall, wallClaimedAt);
  } catch (error) {
    // Nothing was pressed. Release the claim as `failed` if the document is reachable; if it is not, it lapses after
    // CLAIM_TTL_MS of every other client's watch.
    await settle(core, mark, claim, "failed").catch(() => undefined);
    return { kind: "failed", reason: failure(error), attempt: claim.attempt ?? "" };
  }
  if (!press) {
    await settle(core, mark, claim, "failed").catch(() => undefined);
    return {
      kind: "failed",
      reason: "the claim lapsed or was taken before the key press; nothing was pressed",
      attempt: claim.attempt ?? "",
    };
  }
  try {
    await core.keys(mark.terminal, [mark.prompt.keys[answer]]);
  } catch (error) {
    await settle(core, mark, claim, "unknown").catch(() => undefined);
    return { kind: "unknown", reason: failure(error) };
  }
  // The key was delivered. If `sent` cannot be written, the claim lapses later and the screen re-check finds no prompt.
  await settle(core, mark, claim, "sent").catch(() => undefined);
  return { kind: "sent" };
}
