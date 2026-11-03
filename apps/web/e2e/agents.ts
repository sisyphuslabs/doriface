import type { Locator, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn } from "./machine-switch.ts";

/** A program that reports `state` over OSC 7501 and then waits, started straight on one core. */
export function startAgent(core: "host" | "machine", name: string, state: string, space = "api"): string {
  const report = `printf '\\033]7501;state=${state}\\033\\\\'; exec sleep 600`;
  const out = hcOn(core, ["run", "--bg", "--name", name, "--label", `space=${space}`, "--", "sh", "-c", report]);
  const started: unknown = JSON.parse(out);
  if (typeof started !== "object" || started === null || !("address" in started)) throw new Error(out);
  return String(started.address);
}

/** A plain shell with a neutral prompt, started straight on one core. */
export function startShell(core: "host" | "machine", name: string): string {
  const out = hcOn(core, ["run", "--bg", "--name", name, "--label", "space=api", "--", "env", "PS1=$ ", "sh"]);
  const started: unknown = JSON.parse(out);
  if (typeof started !== "object" || started === null || !("address" in started)) throw new Error(out);
  return String(started.address);
}

/** A shell hc keeps: if its program dies, hc revives a shell in the same terminal (`run --keep`). */
export function startKeptShell(core: "host" | "machine", name: string): string {
  const out = hcOn(core, [
    "run",
    "--bg",
    "--keep",
    "--name",
    name,
    "--label",
    "space=api",
    "--",
    "env",
    "PS1=$ ",
    "sh",
  ]);
  const started: unknown = JSON.parse(out);
  if (typeof started !== "object" || started === null || !("address" in started)) throw new Error(out);
  return String(started.address);
}

/** Kills a terminal's program with SIGKILL, as a crash would, after checking the pid is that terminal's shell. */
export function crashProgram(core: "host" | "machine", address: string): void {
  const got: unknown = JSON.parse(hcOn(core, ["get", address, "--json"]));
  const pid = typeof got === "object" && got !== null && "pid" in got ? Number(got.pid) : Number.NaN;
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`no program pid for ${address}`);
  const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  if (!/\bsh\b/.test(command)) throw new Error(`pid ${pid} is not the shell: ${command}`);
  process.kill(pid, "SIGKILL");
}

/** Ends and removes a terminal on the core that started it, so later specs count the machine's terminals from zero. */
export function endAgent(core: "host" | "machine", address: string): void {
  hcOn(core, ["kill", address]);
  hcOn(core, ["rm", address]);
}

/** The row of an agent in a page or a section: on the added machine (`remote`) or on this one. */
export function agentRow(scope: Page | Locator, name: string, remote: boolean) {
  const rows = scope.getByRole("button", { name: new RegExp(`\\b${name}\\b`) });
  return (remote ? rows.filter({ hasText: MACHINE_NAME }) : rows.filter({ hasNotText: MACHINE_NAME })).first();
}
