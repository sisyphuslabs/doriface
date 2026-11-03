import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "./fixtures.ts";
import { MACHINE_ENV, MACHINE_NAME, MACHINE_SWITCH } from "./machine.ts";

/** How long a machine's state may lag behind hc: one periodic re-read of machine.list plus slack. */
const STATE_BOUND_MS = 25_000;

const machineRow = (page: Page) => page.getByRole("button", { name: new RegExp(`^${MACHINE_NAME}\\b`) });
const newOn = (page: Page) => page.getByRole("button", { name: `New terminal on ${MACHINE_NAME}` });

/** Makes the next dial to the machine fail (`off`) or ask for a login (`login`), then stops its core so the open line drops. */
function switchTo(mode: "off" | "login"): void {
  writeFileSync(MACHINE_SWITCH, mode);
  const saved: unknown = JSON.parse(readFileSync(MACHINE_ENV, "utf8"));
  if (typeof saved !== "object" || saved === null || !("hc" in saved) || !("env" in saved)) {
    throw new Error("the e2e host saved no machine environment");
  }
  const { hc, env } = saved;
  if (typeof hc !== "string" || typeof env !== "object" || env === null) throw new Error("bad machine environment");
  execFileSync(hc, ["server", "stop"], { env: { ...process.env, ...env }, stdio: "ignore" });
}

test.describe("machines added with hc machine add", () => {
  test("New terminal on a machine starts its shell there and attaches it at machine/tN", async ({ page }) => {
    await page.goto("/");
    await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
    await newOn(page).click({ force: true });
    const focused = page.locator('[data-focused="true"] [data-terminal]');
    await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${MACHINE_NAME}/t\\d+$`), { timeout: 15_000 });
    const address = await focused.getAttribute("data-terminal");
    await expect(page.locator('[data-focused="true"] header')).toContainText(address ?? "missing");
    await focused.click();
    await page.keyboard.type("echo on-build-box-$((40 + 2))\r");
    await expect(focused).toContainText("on-build-box-42", { timeout: 15_000 });
    await page.keyboard.type("exit\r");
    await expect(machineRow(page)).toContainText(/connected\s*0/, { timeout: 15_000 });
    await expect(machineRow(page)).toBeDisabled();
    await expect(machineRow(page)).toHaveCSS("opacity", "0.45");
  });

  test("a machine that goes offline with the page open reads unreachable and offers no new terminal", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
    try {
      switchTo("off");
      await expect(machineRow(page)).toContainText("unreachable", { timeout: STATE_BOUND_MS });
      await expect(newOn(page)).toBeDisabled();
      expect(errors).toEqual([]);
    } finally {
      rmSync(MACHINE_SWITCH, { force: true });
    }
  });

  test("a machine that asks for a login reads needs login in the attention tone", async ({ page }) => {
    await page.goto("/");
    await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
    try {
      switchTo("login");
      const state = machineRow(page).getByText("needs login", { exact: true });
      await expect(state).toBeVisible({ timeout: STATE_BOUND_MS });
      await expect(state).toHaveClass(/text-status-blocked-text/);
      await expect(newOn(page)).toBeDisabled();
    } finally {
      rmSync(MACHINE_SWITCH, { force: true });
    }
  });
});
