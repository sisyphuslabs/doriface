import type { Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { E2E_HOST_ENV } from "./config.ts";
import { MACHINE_ENV, MACHINE_LINE_PID, MACHINE_NAME, MACHINE_SWITCH } from "./machine.ts";
import { readSavedEnv } from "./saved-env.ts";

/** How long a machine's state may lag behind hc: one periodic re-read of machine.list plus slack. */
export const STATE_BOUND_MS = 25_000;

export const machineRow = (page: Page) => page.getByRole("button", { name: new RegExp(`^${MACHINE_NAME}\\b`) });
export const newOn = (page: Page) => page.getByRole("button", { name: `New terminal on ${MACHINE_NAME}` });

/** Runs hc against the e2e core (`host`) or the added machine's own core (`machine`); returns its stdout. */
export function hcOn(core: "host" | "machine", args: readonly string[], input?: string): string {
  const { hc, env } = readSavedEnv(core === "host" ? E2E_HOST_ENV : MACHINE_ENV);
  const options = { env: { ...process.env, ...env }, encoding: "utf8" } as const;
  return execFileSync(hc, args, input === undefined ? options : { ...options, input });
}

/**
 * Makes the next dial to the machine fail (`off`) or ask for a login (`login`), then stops its core so the open line
 * drops. `drop` refuses the next dial too but only ends the line's process: the machine's core and its terminals keep
 * running, as when the network or doriface-host between the two goes away.
 */
export function switchTo(mode: "off" | "login" | "drop"): void {
  writeFileSync(MACHINE_SWITCH, mode === "login" ? "login" : "off");
  if (mode !== "drop") return void hcOn("machine", ["server", "stop"]);
  // Every dial appends its pid; hc may hold more than one line, so each one still running hc's `connect` ends. macOS
  // sh execs the line itself; Linux dash keeps a `sh -c` around it, so its children go too. Dead or reused pids are skipped.
  const pids = readFileSync(MACHINE_LINE_PID, "utf8")
    .split("\n")
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1);
  // Only this run's lines: the dial runs them under the second core's HC_SESSION (`exec env ...`), which `ps e` shows.
  const session = `HC_SESSION=${readSavedEnv(MACHINE_ENV).env["HC_SESSION"] ?? "?"}`;
  const lines = pids.filter((pid) => {
    const seen = spawnSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout;
    return /\bconnect\b/.test(seen) && seen.includes(session);
  });
  if (lines.length === 0) throw new Error(`no live line among ${pids.join(", ")}`);
  for (const pid of lines) {
    for (const child of childrenOf(pid)) terminate(child);
    terminate(pid);
  }
}

/** SIGTERM; a process that exited meanwhile (dash's `sh -c` ends once its line does) is already stopped. */
function terminate(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

function childrenOf(pid: number): number[] {
  const found = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  return found.stdout.split("\n").flatMap((line) => (line.trim() === "" ? [] : [Number(line)]));
}

/** Lets the machine answer again; hc redials on its own. */
export function switchOn(): void {
  rmSync(MACHINE_SWITCH, { force: true });
}

/** Lets the machine answer and dials it now (`machine.connect`), instead of waiting out hc's redial backoff (up to 30 s). */
export function reconnect(name = MACHINE_NAME): void {
  switchOn();
  const call = { jsonrpc: "2.0", id: 1, method: "machine.connect", params: { machine: name } };
  hcOn("host", ["connect"], `${JSON.stringify(call)}\n`);
}
