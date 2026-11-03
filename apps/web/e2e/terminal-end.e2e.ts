import { execFileSync } from "node:child_process";
import { E2E_HOST_ENV } from "./config.ts";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { readSavedEnv } from "./saved-env.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

function hc(args: readonly string[]): string {
  const { hc: bin, env } = readSavedEnv(E2E_HOST_ENV);
  return execFileSync(bin, args, { env: { ...process.env, ...env }, encoding: "utf8" });
}

test("a kept terminal whose program is lost keeps its tab and attaches to the restarted shell", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  const terminal = await openNewTerminal(page);
  const address = (await terminal.getAttribute("data-terminal")) ?? "";
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  const tabsBefore = await tabs.count();
  hc(["keep", address]);
  const pid = (): unknown => JSON.parse(hc(["get", address, "--json"])).pid;
  const shellPid = pid();

  // SIGKILL leaves no exit code, so the core counts the shell as lost and restarts it in place.
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("kill -9 $$");
  await page.keyboard.press("Enter");
  await expect.poll(pid, { timeout: 30_000 }).not.toBe(shellPid);

  await expect(tabs).toHaveCount(tabsBefore);
  // The restarted shell's view is a new one: the lost shell's screen, with the kill, is gone from it.
  const restarted = page.locator(`[data-terminal="${address}"]`);
  await expect(restarted).not.toContainText("kill -9", { timeout: 15_000 });
  await expect(restarted).toContainText("$", { timeout: 15_000 });
  await restarted.getByRole("textbox").focus();
  await page.keyboard.type("echo back-$((2+3))");
  await page.keyboard.press("Enter");
  await expect(restarted).toContainText("back-5", { timeout: 15_000 });
});
