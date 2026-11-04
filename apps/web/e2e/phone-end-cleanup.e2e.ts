import { devices, type Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { hcOn } from "./machine-switch.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ ...phone, serviceWorkers: "block" });

const NAME = "phone-end-cleanup";

const header = (page: Page) => page.getByRole("banner");

/** The states of the terminals the e2e core still holds under this spec's name, finished ones included. */
function heldOnCore(): string[] {
  const listed: unknown = JSON.parse(hcOn("host", ["ls", "--all", "--json", "--label", `herdr.name=${NAME}`]));
  const terminals = typeof listed === "object" && listed !== null ? Reflect.get(listed, "terminals") : undefined;
  if (!Array.isArray(terminals)) throw new Error("hc ls printed no terminal list");
  return terminals.map((terminal: unknown) =>
    String(typeof terminal === "object" && terminal !== null ? Reflect.get(terminal, "state") : terminal),
  );
}

// #168: the list showed as soon as the program ended, while terminal.rm was still on its way; a page closed then left
// the terminal on the core as finished.
test("on a phone an ended session is gone from the core once the agents list shows", async ({ page }) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  await header(page).getByRole("button", { name: "New tab" }).click();
  await expect(page.locator("[data-terminal]")).toContainText("$", { timeout: 15_000 });

  await header(page)
    .getByRole("button", { name: /^Session actions for / })
    .click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page
    .getByRole("dialog", { name: /^Rename / })
    .getByRole("textbox", { name: "Name" })
    .fill(NAME);
  await page.keyboard.press("Enter");
  await expect(header(page).getByRole("heading", { name: NAME })).toBeVisible();
  expect(heldOnCore()).toEqual(["live"]);

  // The removal is slow to arrive, as over the relay: the program has ended, the terminal is not yet removed.
  const release = socket.hold("terminal.rm");
  await header(page)
    .getByRole("button", { name: `Session actions for ${NAME}` })
    .click();
  await page.getByRole("menuitem", { name: "End session…" }).click();
  await page
    .getByRole("dialog", { name: `End ${NAME}?` })
    .getByRole("button", { name: "End session" })
    .click();
  await expect.poll(heldOnCore, { timeout: 15_000 }).toEqual(["finished"]);
  await expect.poll(() => socket.sent().some((frame) => frame.includes('"method":"terminal.rm"'))).toBe(true);
  // Once the page knows the program ended, either it has left for the list or its terminal screen shows it done.
  const agents = page.getByRole("heading", { name: "Agents" });
  const done = page.locator("header[data-titlebar]").getByText("Done", { exact: true });
  await expect(agents.or(done)).toBeVisible({ timeout: 15_000 });
  // End is not done yet: the terminal's screen and the question stay up.
  await expect(agents).toBeHidden();
  await expect(page.getByRole("dialog", { name: `End ${NAME}?` })).toBeVisible();

  release();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 15_000 });
  await page.close();
  expect(heldOnCore()).toEqual([]);
});
