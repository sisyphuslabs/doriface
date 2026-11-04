import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { E2E_HOST_ENV } from "./config.ts";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { type HcSocket, routeHcSocket } from "./hc-socket.ts";
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

// By tag, not role: an open dialog marks the page behind it aria-hidden, which a role query would read as absent.
const agentsList = (page: Page) => page.locator("h1", { hasText: /^Agents$/ });
const screenTitle = (page: Page) => page.locator("header h1");

/** On the phone page: opens `name`, asks End, and has its terminal.rm leave the page but not reach the core yet. */
async function endWithRemovalHeld(phone: Page, link: HcSocket, name: string): Promise<() => void> {
  await phone.getByText(name).first().click();
  await expect(screenTitle(phone)).toHaveText(name);
  await phone
    .getByRole("banner")
    .getByRole("button", { name: /^Session actions for / })
    .click();
  await phone.getByRole("menuitem", { name: "End session…" }).click();
  const deliver = link.hold("terminal.rm");
  await phone
    .getByRole("dialog", { name: `End ${name}?` })
    .getByRole("button", { name: "End session" })
    .click();
  await expect.poll(() => link.sent().some((frame) => frame.includes('"method":"terminal.rm"'))).toBe(true);
  return deliver;
}

/** A phone-sized page with a new terminal named `name-<address>`; returns the page's link, the name and the address. */
async function phoneWithTerminal(page: Page, name: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const link = await routeHcSocket(page);
  await page.goto("/");
  await expect(agentsList(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("banner").getByRole("button", { name: "New tab" }).click();
  const terminal = page.locator("[data-terminal]");
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  const address = await terminal.getAttribute("data-terminal");
  if (address === null) throw new Error("the new terminal has no address");
  const named = `${name}-${address}`;
  hc("label", address, `herdr.name=${named}`);
  await page.getByRole("button", { name: "Back to agents" }).click();
  await expect(page.getByText(named).first()).toBeVisible({ timeout: 15_000 });
  return { link, name: named, address };
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
  await expect(agentsList(phone)).toBeVisible({ timeout: 20_000 });
  const deliver = await endWithRemovalHeld(phone, link, name);
  // The program has exited, but the removal is unanswered: End is still working and the phone keeps the session's
  // screen, so there is no list (and no moment to close the page) yet.
  const ask = phone.getByRole("dialog", { name: `End ${name}?` });
  await expect(ask.getByRole("button", { name: "End session" })).toHaveAttribute("aria-busy", "true");
  await expect(screenTitle(phone)).toHaveText(name);
  await expect(agentsList(phone)).toHaveCount(0);
  deliver();
  await expect(ask).toHaveCount(0, { timeout: 15_000 });
  await expect(agentsList(phone)).toBeVisible({ timeout: 15_000 });
  await phone.close();

  await expect.poll(() => onCore(address), { timeout: 10_000, message: `${address} still on the core` }).toBe(false);
  await expect(page.getByRole("tab", { name })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText("This terminal didn't open")).toHaveCount(0);
});

test("a session renamed and ended on a phone is removed even when the page closes as soon as End is confirmed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const link = await routeHcSocket(page);
  await page.goto("/");
  await expect(agentsList(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("banner").getByRole("button", { name: "New tab" }).click();
  const terminal = page.locator("[data-terminal]");
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  const address = await terminal.getAttribute("data-terminal");
  if (address === null) throw new Error("the new terminal has no address");
  const name = `end-at-once-${address}`;
  const actions = page.getByRole("banner").getByRole("button", { name: /^Session actions for / });
  await actions.click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page
    .getByRole("dialog", { name: /^Rename / })
    .getByRole("textbox", { name: "Name" })
    .fill(name);
  await page.keyboard.press("Enter");
  await expect(screenTitle(page)).toHaveText(name);
  await actions.click();
  await page.getByRole("menuitem", { name: "End session…" }).click();
  // The kill's answer has not come back when the page closes, as over a slow relay: the answer is held, never released.
  link.holdFromHost('"state":"finished"');
  await page
    .getByRole("dialog", { name: `End ${name}?` })
    .getByRole("button", { name: "End session" })
    .click();
  // A role query for the terminal screen already reads it as gone: the End question hides the page behind it.
  await expect(page.getByRole("button", { name: "Back to agents" })).toHaveCount(0);
  await expect.poll(() => link.sent().some((frame) => frame.includes('"method":"terminal.kill"'))).toBe(true);
  await page.close();

  await expect.poll(() => onCore(address), { timeout: 10_000, message: `${address} still on the core` }).toBe(false);
});

test("an End whose removal fails says so, lets the phone leave, and a second End finishes it", async ({ page }) => {
  const { link, name, address } = await phoneWithTerminal(page, "end-fails");
  const deliver = await endWithRemovalHeld(page, link, name);
  // The link drops with terminal.rm unanswered: the removal fails, and the program has already exited.
  const sockets = link.opened();
  await link.drop(false);
  const ask = page.getByRole("dialog", { name: `End ${name}?` });
  await expect(ask.getByRole("alert")).toContainText("The session did not end", { timeout: 15_000 });
  await expect(ask.getByRole("button", { name: "End session" })).not.toHaveAttribute("aria-busy", "true");
  await expect(agentsList(page)).toBeVisible({ timeout: 15_000 });
  expect(onCore(address)).toBe(true);
  // Once the link is back (a new socket, and no connection notice: a tag query, as the dialog hides the page from roles),
  // try again; its own terminal.rm is held until it is out, so its success is what removes the terminal.
  await expect.poll(link.opened, { timeout: 15_000 }).toBeGreaterThan(sockets);
  await expect(page.locator('[role="status"]', { hasText: /Reconnecting|Offline/ })).toHaveCount(0, {
    timeout: 15_000,
  });
  const removals = () => link.sent().filter((frame) => frame.includes('"method":"terminal.rm"')).length;
  const before = removals();
  await ask.getByRole("button", { name: "End session" }).click();
  await expect.poll(removals).toBeGreaterThan(before);
  deliver();
  await expect(ask).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => onCore(address), { timeout: 10_000, message: `${address} still on the core` }).toBe(false);
});

test("a session another client removes while End's removal is held closes the question without an error", async ({
  page,
}) => {
  const { link, name, address } = await phoneWithTerminal(page, "end-elsewhere");
  const deliver = await endWithRemovalHeld(page, link, name);
  await expect.poll(() => onCore(address) && hc("ls", "--all", "--json").includes('"finished"')).toBe(true);
  hc("rm", address);
  await expect.poll(() => onCore(address)).toBe(false);
  deliver();
  const ask = page.getByRole("dialog", { name: `End ${name}?` });
  await expect(ask).toHaveCount(0, { timeout: 15_000 });
  await expect(agentsList(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
