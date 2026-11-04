import type { Status, Terminal } from "../__generated__/hc-api.ts";

/** A live terminal as `terminal.get` reports it, with the status fields an approval reads. */
export function terminalAt(
  address: string,
  status: Status | null,
  at: { readonly statusMs?: number; readonly turn?: number; readonly state?: string } = {},
): Terminal {
  return {
    address,
    argv: ["claude"],
    cols: 200,
    created_ms: 1,
    cwd: "/work",
    labels: {},
    rows: 120,
    screen: "exact",
    state: at.state ?? "live",
    status,
    status_ms: at.statusMs ?? 1000,
    turn: at.turn ?? 1,
  };
}

export const CLAUDE_BLOCKED: Status = {
  app: "claude-code",
  kind: "permission",
  msg: "approve Bash: touch probe-a.txt",
  state: "blocked",
};
export const CODEX_BLOCKED: Status = { app: "codex", kind: "permission", state: "blocked" };
