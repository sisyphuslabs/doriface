import { execFileSync } from "node:child_process";
import type { Locator } from "@playwright/test";
import { E2E_HOST_ENV } from "./config.ts";
import { readSavedEnv } from "./saved-env.ts";

/** The pty size the core holds for a terminal, as "rows cols", read with hc so nothing is typed into it. */
export function coreSize(address: string): string {
  const { hc, env } = readSavedEnv(E2E_HOST_ENV);
  const terminal: unknown = JSON.parse(
    execFileSync(hc, ["get", address, "--json"], { env: { ...process.env, ...env }, encoding: "utf8" }),
  );
  if (typeof terminal !== "object" || terminal === null || !("rows" in terminal) || !("cols" in terminal)) {
    throw new Error(`hc get ${address} printed no size`);
  }
  return `${String(terminal.rows)} ${String(terminal.cols)}`;
}

/** The grid the view renders, as "rows cols": a blank row renders one cell per column. */
export const gridSize = (terminal: Locator): Promise<string> =>
  terminal.evaluate((element) => {
    const rows = element.querySelectorAll(".term-row:not(.term-scrollback-row)");
    return `${rows.length} ${rows[rows.length - 1]?.textContent?.length ?? 0}`;
  });
