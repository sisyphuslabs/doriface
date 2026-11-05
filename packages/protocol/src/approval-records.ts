import type { ApprovalCore } from "./approval-live.ts";
import { type ApprovalMark, approvalKey } from "./approval-prompt.ts";
import type { ApprovalAnswer } from "./approval-screen.ts";
import { isJsonObject, type JsonValue } from "./json.ts";

/** Who answers: a device name people recognise, and this client's own id, so two tabs of one browser are told apart. */
export interface Answerer {
  readonly by: string;
  readonly client: string;
}

/**
 * `claimed`: the claimer is checking the screen and pressing. `sent`: the agent's key was delivered. `stale`: the prompt
 * had gone; nothing was pressed. `failed`: the answer stopped before any key press (a dropped connection, a claim that
 * lapsed); anyone may answer again, through the same re-check. `unknown`: the key press itself failed, so it may have
 * reached the agent; the prompt is held until the screen moves, and no client answers it again.
 */
export type ApprovalOutcome = "claimed" | "sent" | "stale" | "failed" | "unknown";

export interface ApprovalRecord extends Answerer {
  readonly prompt: string;
  readonly answer: ApprovalAnswer;
  /** The claimer's wall clock when it claimed: for people only, never compared with another device's clock. */
  readonly atMs: number;
  /** One answer's own id: only that answer settles its record or presses under it. */
  readonly attempt?: string;
  readonly outcome: ApprovalOutcome;
}

/** Records kept per terminal: newest last. Older prompts' records drop off; they only ever serve "answered on ...". */
const KEPT = 16;
const ATTEMPTS = 8;

function docOf(address: string): { readonly name: string; readonly on: string | undefined } {
  const slash = address.indexOf("/");
  return slash === -1
    ? { name: `approval.${address}`, on: undefined }
    : { name: `approval.${address.slice(slash + 1)}`, on: address.slice(0, slash) };
}

const OUTCOMES: ReadonlySet<unknown> = new Set(["claimed", "sent", "stale", "failed", "unknown"]);

function isRecord(value: unknown): value is ApprovalRecord {
  if (typeof value !== "object" || value === null) return false;
  const field = (name: string): unknown => Reflect.get(value, name);
  const attempt = field("attempt");
  return (
    typeof field("prompt") === "string" &&
    (field("answer") === "allow" || field("answer") === "deny") &&
    typeof field("by") === "string" &&
    typeof field("client") === "string" &&
    typeof field("atMs") === "number" &&
    (attempt === undefined || typeof attempt === "string") &&
    OUTCOMES.has(field("outcome"))
  );
}

function recordsIn(value: JsonValue): ApprovalRecord[] {
  const list = isJsonObject(value) ? value["records"] : undefined;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

export const recordJson = (record: ApprovalRecord, outcome = record.outcome): JsonValue => ({
  prompt: record.prompt,
  answer: record.answer,
  by: record.by,
  client: record.client,
  atMs: record.atMs,
  ...(record.attempt === undefined ? {} : { attempt: record.attempt }),
  outcome,
});

/** The terminal's records with `change` applied, or undefined to leave the document as it is. */
export type Change = (records: readonly ApprovalRecord[]) => readonly JsonValue[] | undefined;

/**
 * The terminal's approval document, then `change` applied and written back at the version read, retried on a conflict.
 * Returns the records as read when `change` left the document alone, undefined once its write landed.
 */
export async function update(
  core: ApprovalCore,
  address: string,
  change: Change,
  attempt = 1,
): Promise<readonly ApprovalRecord[] | undefined> {
  const { name, on } = docOf(address);
  const current = await core.doc(name, on);
  const next = change(recordsIn(current.value));
  if (next === undefined) return recordsIn(current.value);
  if ((await core.setDoc(name, on, { records: next.slice(-KEPT) }, current.version)) === "ok") return undefined;
  if (attempt >= ATTEMPTS) throw new Error(`approval document ${name} kept moving: ${ATTEMPTS} conflicts in a row`);
  return update(core, address, change, attempt + 1);
}

/** Every record of the terminal that holds the marked prompt, as the core has them now. */
export async function readRecords(core: ApprovalCore, address: string): Promise<readonly ApprovalRecord[]> {
  const { name, on } = docOf(address);
  return recordsIn((await core.doc(name, on)).value);
}

/** What was recorded for the marked prompt, by whichever client answered it. */
export async function readApprovalRecord(core: ApprovalCore, mark: ApprovalMark): Promise<ApprovalRecord | undefined> {
  const key = approvalKey(mark);
  return (await readRecords(core, mark.terminal)).findLast((record) => record.prompt === key);
}
