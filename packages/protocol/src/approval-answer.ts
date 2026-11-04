import { promptStillThere, type ApprovalCore } from "./approval-live.ts";
import { type ApprovalMark, approvalKey } from "./approval-prompt.ts";
import type { ApprovalAnswer } from "./approval-screen.ts";
import { isJsonObject, type JsonValue } from "./json.ts";

/** Who answers: a device name people recognise, and this client's own id, so two tabs of one browser are told apart. */
export interface Answerer {
  readonly by: string;
  readonly client: string;
}

/** `claimed`: the winner is checking the screen. `sent`: it pressed the agent's key. `stale`: the prompt had gone; nothing was pressed. */
export type ApprovalOutcome = "claimed" | "sent" | "stale";

export interface ApprovalRecord extends Answerer {
  readonly prompt: string;
  readonly answer: ApprovalAnswer;
  readonly atMs: number;
  readonly outcome: ApprovalOutcome;
}

export type AnswerResult =
  | { readonly kind: "sent" }
  | { readonly kind: "stale" }
  /** Another device claimed this prompt first; its record says who and what. */
  | { readonly kind: "lost"; readonly record: ApprovalRecord };

/** Records kept per terminal: newest last. Older prompts' records drop off; they only ever serve "answered on ...". */
const KEPT = 16;
const ATTEMPTS = 8;

function docOf(address: string): { readonly name: string; readonly on: string | undefined } {
  const slash = address.indexOf("/");
  return slash === -1
    ? { name: `approval.${address}`, on: undefined }
    : { name: `approval.${address.slice(slash + 1)}`, on: address.slice(0, slash) };
}

const OUTCOMES: ReadonlySet<unknown> = new Set(["claimed", "sent", "stale"]);

function isRecord(value: unknown): value is ApprovalRecord {
  if (typeof value !== "object" || value === null) return false;
  const field = (name: string): unknown => Reflect.get(value, name);
  return (
    typeof field("prompt") === "string" &&
    (field("answer") === "allow" || field("answer") === "deny") &&
    typeof field("by") === "string" &&
    typeof field("client") === "string" &&
    typeof field("atMs") === "number" &&
    OUTCOMES.has(field("outcome"))
  );
}

function recordsIn(value: JsonValue): ApprovalRecord[] {
  const list = isJsonObject(value) ? value["records"] : undefined;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

const recordJson = (record: ApprovalRecord, outcome = record.outcome): JsonValue => ({
  prompt: record.prompt,
  answer: record.answer,
  by: record.by,
  client: record.client,
  atMs: record.atMs,
  outcome,
});

/** The terminal's records with `change` applied, or undefined to leave the document as it is. */
type Change = (records: readonly ApprovalRecord[]) => readonly JsonValue[] | undefined;

/** The terminal's approval document, then `change` applied and written back at the version read, retried on a conflict. */
async function update(
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

/** What was recorded for the marked prompt, by whichever client answered it. */
export async function readApprovalRecord(core: ApprovalCore, mark: ApprovalMark): Promise<ApprovalRecord | undefined> {
  const { name, on } = docOf(mark.terminal);
  const key = approvalKey(mark);
  return recordsIn((await core.doc(name, on)).value).findLast((record) => record.prompt === key);
}

async function settle(core: ApprovalCore, mark: ApprovalMark, client: string, outcome: ApprovalOutcome): Promise<void> {
  const key = approvalKey(mark);
  await update(core, mark.terminal, (records) =>
    records.map((record) =>
      recordJson(record, record.prompt === key && record.client === client ? outcome : record.outcome),
    ),
  );
}

/**
 * Answer one prompt, exactly once across every client: claim it in the terminal's approval document with a
 * compare-and-set (`doc.set` at the version read; the first writer wins, a later one finds the record and loses), then
 * re-read the live screen and press the agent's own key only if the marked prompt is still there.
 *
 * Someone typing in the terminal itself is not part of the claim: between the re-read and the key press they can still
 * answer first. Closing that needs a conditional `terminal.keys` in hc.
 */
export async function answerApproval(
  core: ApprovalCore,
  mark: ApprovalMark,
  answer: ApprovalAnswer,
  who: Answerer,
  nowMs: number,
): Promise<AnswerResult> {
  const key = approvalKey(mark);
  const claim: ApprovalRecord = { prompt: key, answer, ...who, atMs: nowMs, outcome: "claimed" };
  const taken = await update(core, mark.terminal, (records) =>
    records.some((record) => record.prompt === key)
      ? undefined
      : [...records, claim].map((record) => recordJson(record)),
  );
  const winner = taken?.findLast((record) => record.prompt === key);
  if (winner !== undefined) return { kind: "lost", record: winner };

  if ((await promptStillThere(core, mark)) !== "pending") {
    await settle(core, mark, who.client, "stale");
    return { kind: "stale" };
  }
  await core.keys(mark.terminal, [mark.prompt.keys[answer]]);
  await settle(core, mark, who.client, "sent");
  return { kind: "sent" };
}
