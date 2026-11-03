import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { E2E_HOST_ENV } from "./config.ts";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { readSavedEnv } from "./saved-env.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

function hc(args: readonly string[]): string {
  const { hc: bin, env } = readSavedEnv(E2E_HOST_ENV);
  return execFileSync(bin, args, { env: { ...process.env, ...env }, encoding: "utf8" });
}

/** The pid of the program running in the terminal, or null while a kept terminal waits for its new shell. */
function pidOf(address: string): number | null {
  const terminal: unknown = JSON.parse(hc(["get", address, "--json"]));
  if (typeof terminal !== "object" || terminal === null || !("pid" in terminal)) return null;
  return typeof terminal.pid === "number" ? terminal.pid : null;
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

test("keys typed offline for a kept program that is lost and restarted meanwhile do not run in the new shell", async ({
  page,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const address = (await terminal.getAttribute("data-terminal")) ?? "";
  hc(["keep", address]);
  const shellPid = pidOf(address);
  if (shellPid === null) throw new Error(`${address} has no program`);
  // Marks this view, so the fresh one the restarted program gets is told apart from it.
  await terminal.evaluate((element) => element.setAttribute("data-before-restart", ""));
  await terminal.getByRole("textbox").focus();

  await socket.drop(true);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  const misdelivered = test.info().outputPath("misdelivered.txt");
  await page.keyboard.type(`echo misdeliv-$((5*5)) > '${misdelivered}'`);
  await page.keyboard.press("Enter");
  process.kill(shellPid, "SIGKILL");
  await expect.poll(() => pidOf(address), { timeout: 30_000 }).not.toBeNull();
  expect(pidOf(address)).not.toBe(shellPid);
  socket.restore();

  const restarted = page.locator(`[data-terminal="${address}"]:not([data-before-restart])`);
  await expect(restarted).toContainText("$", { timeout: 20_000 });
  await restarted.getByRole("textbox").focus();
  await page.keyboard.type("echo fence-$((1+2))");
  await page.keyboard.press("Enter");
  await expect(restarted).toContainText("fence-3", { timeout: 15_000 });
  expect(existsSync(misdelivered)).toBe(false);
  await expect(page.getByText("Typed input was not sent because the program restarted")).toBeVisible();
});

test("a reconnect inside a kept program's restart shows it restarting, not an error, then attaches", async ({
  page,
}) => {
  // Every attach error the page ever renders, however briefly.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { attachErrors: seen });
    new MutationObserver(() => {
      for (const node of document.querySelectorAll("p")) {
        const text = node.textContent ?? "";
        if (text.startsWith("Could not open") && !seen.includes(text)) seen.push(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const socket = await routeHcSocket(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const address = (await terminal.getAttribute("data-terminal")) ?? "";
  hc(["keep", address]);
  const shellPid = pidOf(address);
  if (shellPid === null) throw new Error(`${address} has no program`);
  await terminal.evaluate((element) => element.setAttribute("data-before-restart", ""));

  await socket.drop(true);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  process.kill(shellPid, "SIGKILL");
  // Lost, waiting for its new shell: the reconnect lands in this window.
  await expect.poll(() => pidOf(address), { timeout: 15_000 }).toBeNull();
  socket.restore();

  const restarted = page.locator(`[data-terminal="${address}"]:not([data-before-restart])`);
  await expect(restarted).toContainText("$", { timeout: 30_000 });
  await restarted.getByRole("textbox").focus();
  await page.keyboard.type("echo back-$((6*7))");
  await page.keyboard.press("Enter");
  await expect(restarted).toContainText("back-42", { timeout: 15_000 });
  expect(await page.evaluate(() => Reflect.get(window, "attachErrors"))).toEqual([]);
});
