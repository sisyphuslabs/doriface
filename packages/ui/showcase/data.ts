import type { Agent, Command, Space, TerminalLine, WorkspaceTab } from "../src/index.ts";

export const SPACES: readonly Space[] = [
  { id: "api", name: "api-server", tabs: 3, attention: "blocked" },
  { id: "web", name: "web-client", tabs: 2, attention: "working" },
  { id: "infra", name: "infra", machine: "build-box", tabs: 1, attention: "done" },
  { id: "notes", name: "release-notes", tabs: 1 },
];

export const AGENTS_NEEDS_YOU: readonly Agent[] = [
  { id: "a1", name: "Claude Code", detail: "approve migration", status: "blocked", age: "2m" },
];
export const AGENTS_DONE: readonly Agent[] = [
  { id: "a2", name: "Codex", detail: "file sync tests", status: "done", age: "6m" },
];
export const AGENTS_WORKING: readonly Agent[] = [
  { id: "a3", name: "Claude Code", detail: "web-client", status: "working", age: "<1m" },
  { id: "a4", name: "Codex", detail: "terraform plan", status: "working", machine: "build-box", age: "12m" },
];
export const AGENTS_IDLE: readonly Agent[] = [
  { id: "a5", name: "shell", detail: "release-notes", status: "idle", age: "1h" },
];

export const TABS: readonly WorkspaceTab[] = [
  { id: "t1", title: "Claude Code", status: "blocked" },
  { id: "t2", title: "Codex", status: "done" },
  { id: "t3", title: "shell" },
];

export const CLAUDE_LINES: readonly TerminalLine[] = [
  [{ text: "~/api-server ", color: 4 }, { text: "main", color: 5 }, { text: " $ claude" }],
  [{ text: "● ", color: 3 }, { text: "Reading migrations/0042_session_keys.sql" }],
  [{ text: "● ", color: 3 }, { text: "Running " }, { text: "bun test db/", bold: true }],
  [
    { text: "  ✓ 41 passed", color: 2 },
    { text: "  ", dim: true },
    { text: "1.82s", dim: true },
  ],
  [],
  [{ text: "  This migration drops ", dim: false }, { text: "sessions.legacy_token", color: 3 }, { text: "." }],
  [{ text: "  Existing rows lose their old tokens and must sign in again." }],
  [],
  [{ text: "  Apply the migration to the staging database?", bold: true }],
  [
    { text: "  ❯ ", color: 6 },
    { text: "1. Yes, apply it", color: 6 },
  ],
  [{ text: "    2. Yes, and don't ask again for migrations" }],
  [{ text: "    3. No, explain the rollback first" }],
];

export const CODEX_LINES: readonly TerminalLine[] = [
  [{ text: "~/api-server ", color: 4 }, { text: "sync", color: 5 }, { text: " $ codex" }],
  [{ text: "• ", color: 4 }, { text: "Implemented file sync with retry and rate limit" }],
  [{ text: "• ", color: 4 }, { text: "Ran " }, { text: "bun test src/sync", bold: true }],
  [],
  [{ text: " PASS ", color: 2, bold: true }, { text: " src/sync/queue.test.ts" }],
  [{ text: " PASS ", color: 2, bold: true }, { text: " src/sync/retry.test.ts" }],
  [{ text: " PASS ", color: 2, bold: true }, { text: " src/sync/limit.test.ts" }],
  [],
  [{ text: "Tests  " }, { text: "27 passed", color: 2 }, { text: " (27)" }],
  [{ text: "Time   3.18s", dim: true }],
  [],
  [{ text: "✓ Done. ", color: 2 }, { text: "4 files changed, +212 −38" }],
  [{ text: "codex › ", color: 8 }],
];

export const COMMANDS: readonly Command[] = [
  { id: "go-claude", group: "Agents", label: "Claude Code · approve migration", hint: "Needs you" },
  { id: "go-codex", group: "Agents", label: "Codex · file sync tests", hint: "Done" },
  { id: "go-tf", group: "Agents", label: "Codex · terraform plan", hint: "build-box" },
  { id: "new-tab", group: "Actions", label: "New tab", keys: ["⌘", "T"] },
  { id: "split", group: "Actions", label: "Split pane right", keys: ["⌘", "D"] },
  { id: "sidebar", group: "Actions", label: "Toggle sidebar", keys: ["⌘", "B"] },
  { id: "pair", group: "Hosts", label: "Pair a new host" },
  { id: "settings", group: "Hosts", label: "Open settings", keys: ["⌘", ","] },
];

/** A deterministic module grid with QR finder patterns, for drawing only. It encodes nothing. */
export function sampleQrModules(size = 29): boolean[][] {
  const finder = (x: number, y: number): boolean | undefined => {
    for (const [ox, oy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ] as const) {
      const dx = x - ox;
      const dy = y - oy;
      if (dx >= -1 && dx <= 7 && dy >= -1 && dy <= 7) {
        if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
        const edge = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        return edge !== 2;
      }
    }
    return undefined;
  };
  let seed = 7;
  return Array.from({ length: size }, (_row, y) =>
    Array.from({ length: size }, (_cell, x) => {
      const fixed = finder(x, y);
      if (fixed !== undefined) return fixed;
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % 7 < 3;
    }),
  );
}
