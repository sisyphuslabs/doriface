import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { MACHINE_ENV, MACHINE_NAME, MACHINE_SWITCH } from "./machine.ts";
import { readSavedEnv } from "./saved-env.ts";

/** How long a machine's state may lag behind hc: one periodic re-read of machine.list plus slack. */
export const STATE_BOUND_MS = 25_000;

export const machineRow = (page: Page) => page.getByRole("button", { name: new RegExp(`^${MACHINE_NAME}\\b`) });
export const newOn = (page: Page) => page.getByRole("button", { name: `New terminal on ${MACHINE_NAME}` });

/** Makes the next dial to the machine fail (`off`) or ask for a login (`login`), then stops its core so the open line drops. */
export function switchTo(mode: "off" | "login"): void {
  writeFileSync(MACHINE_SWITCH, mode);
  const { hc, env } = readSavedEnv(MACHINE_ENV);
  execFileSync(hc, ["server", "stop"], { env: { ...process.env, ...env }, stdio: "ignore" });
}

/** Lets the machine answer again; hc redials on its own. */
export function switchOn(): void {
  rmSync(MACHINE_SWITCH, { force: true });
}
