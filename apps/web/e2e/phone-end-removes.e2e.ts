import { execFileSync } from "node:child_process";
import { E2E_HOST_ENV } from "./config.ts";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { readSavedEnv } from "./saved-env.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

function hc(...args: string[]): string {
  const { hc: bin, env } = readSavedEnv(E2E_HOST_ENV);
  return execFileSync(bin, args, { env: { ...process.env, ...env }, encoding: "utf8" });
}

/** Whether the core still holds this terminal, finished ones included. */
function onCore(address: string): boolean {
  const listed: unknown = JSON.parse(hc("ls", "--all", "--json"));
  const terminals = typeof listed === "object" && listed !== null ? Reflect.get(listed, "terminals") : undefined;
  if (!Array.isArray(terminals)) throw new Error("hc ls printed no terminal list");
  return terminals.some((terminal) => JSON.stringify(terminal).includes(`"${address}"`));
}

test("a session ended on a phone is removed even when the page closes as soon as the list shows", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const address = await terminal.getAttribute("data-terminal");
  if (address === null) throw new Error("the new terminal has no address");
  const name = `end-on-phone-${address}`;
  hc("label", address, `herdr.name=${name}`);
  await expect(page.getByRole("tab", { name })).toBeVisible({ timeout: 15_000 });

  // The phone: a second page of the same browser, narrow, so it shows the phone navigation.
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  const link = await routeHcSocket(phone);
  await phone.goto("/");
  await expect(phone.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  await phone.getByText(name).first().click();
  const header = phone.getByRole("banner");
  await expect(header.getByRole("heading", { name })).toBeVisible();
  await header.getByRole("button", { name: /^Session actions for / }).click();
  await phone.getByRole("menuitem", { name: "End session…" }).click();
  // A slow network: End's terminal.rm leaves the page but has not reached the core yet.
  const deliver = link.hold("terminal.rm");
  await phone
    .getByRole("dialog", { name: `End ${name}?` })
    .getByRole("button", { name: "End session" })
    .click();
  await expect.poll(() => link.sent().some((frame) => frame.includes('"method":"terminal.rm"'))).toBe(true);
  // The program has exited, but the removal is unanswered: the phone must not offer the list (and a way to close) yet.
  await expect(header.getByRole("heading", { name })).toBeVisible();
  await expect(phone.getByRole("heading", { name: "Agents" })).toHaveCount(0, { timeout: 2_000 });
  deliver();
  await expect(phone.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 15_000 });
  await phone.close();

  await expect.poll(() => onCore(address), { timeout: 10_000, message: `${address} still on the core` }).toBe(false);
  await expect(page.getByRole("tab", { name })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText("This terminal didn't open")).toHaveCount(0);
});
