import { requestControl } from "../control.ts";
import { parseLeaveReply, parseRenameReply, parseRevokeReply } from "../mesh/command-replies.ts";
import { printable } from "./devices.ts";

// `mesh revoke`, `mesh rename` and `mesh leave`: each asks the running host on the state dir, which signs (design
// 6.1, 6.5 and 7.5), and prints its answer. Each returns the exit code.

export interface ChangeContext {
  readonly stateDir: string;
  readonly out: (text: string) => void;
  /** Asks the owner on a terminal; false when there is none. */
  readonly confirm: (question: string) => Promise<boolean>;
}

async function ask(context: ChangeContext, request: Parameters<typeof requestControl>[1]): Promise<unknown> {
  const reply = await requestControl(context.stateDir, request);
  if (reply === undefined) throw new Error(`no doriface-host is running on ${context.stateDir}`);
  if (reply === null) context.out("this host is in no mesh\n");
  return reply;
}

const line = (context: ChangeContext, text: string): void => context.out(`${printable(text)}\n`);

export async function revokeMember(context: ChangeContext, member: string, compromised: boolean, yes: boolean) {
  const first = await ask(context, { op: "mesh-revoke", member, compromised, yes });
  if (first === null) return 1;
  let reply = parseRevokeReply(first);
  for (const text of reply.lines) line(context, text);
  if (!reply.written && (await context.confirm("write this revoke? [y/N] "))) {
    const again = await ask(context, { op: "mesh-revoke", member, compromised, yes: true });
    if (again === null) return 1;
    reply = parseRevokeReply(again);
  }
  if (!reply.written) {
    line(context, "not written: run it again with --yes to write this revoke");
    return 1;
  }
  line(context, `revoked ${reply.subjects.map((subject) => subject.name).join(", ")} (${reply.reason})`);
  return 0;
}

export async function renameMember(context: ChangeContext, member: string, name: string) {
  const answer = await ask(context, { op: "mesh-rename", member, name });
  if (answer === null) return 1;
  const reply = parseRenameReply(answer);
  line(
    context,
    reply.written
      ? `renamed ${reply.member.name} to ${reply.name}`
      : `${reply.member.name} is already named ${reply.name}`,
  );
  return 0;
}

export async function leaveMesh(context: ChangeContext) {
  const answer = await ask(context, { op: "mesh-leave" });
  if (answer === null) return 1;
  const reply = parseLeaveReply(answer);
  const names = (refs: typeof reply.members) => refs.map((ref) => ref.name).join(", ");
  if (!reply.signed) line(context, "this host was no member in its own view, so it had no revoke to sign");
  if (reply.members.length === 0) line(context, "left the mesh; no other member was in it");
  else if (reply.confirmed.length > 0) {
    line(
      context,
      `left the mesh: ${reply.confirmed.length} of ${reply.members.length} members confirmed (${names(reply.confirmed)})`,
    );
  } else {
    line(context, `left the mesh, but reached no member within 30 s (${names(reply.members)})`);
    if (reply.revokeCommand !== null) line(context, `run this on one of them: ${reply.revokeCommand}`);
  }
  return 0;
}

export async function confirmOnTerminal(question: string): Promise<boolean> {
  if (process.stdin.isTTY !== true) return false;
  process.stdout.write(question);
  for await (const answer of console) return /^y(es)?$/i.test(answer.trim());
  return false;
}
