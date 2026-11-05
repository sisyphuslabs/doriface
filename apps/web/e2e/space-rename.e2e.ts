// A space's name lives in hc (the `space` label of its terminals), so a rename on one device shows on every other
// device of that host at once, with no reload (#395).
import type { Browser, Page } from "@playwright/test";
import { endAgent } from "./agents.ts";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Workspace" });
// The tab count leaves the row's name while the pointer is on it: the row's actions cover it.
const spaceRow = (page: Page, name: string) =>
  sidebar(page).getByRole("button", { name: new RegExp(`^${name}( \\d+ tabs?)?$`) });

const started: string[] = [];

/** A plain shell in space `space`, started straight on the e2e core. */
function startIn(space: string, name: string): string {
  const out = hcOn("host", ["run", "--bg", "--name", name, "--label", `space=${space}`, "--", "env", "PS1=$ ", "sh"]);
  const parsed: unknown = JSON.parse(out);
  if (typeof parsed !== "object" || parsed === null || !("address" in parsed)) throw new Error(out);
  const address = String(parsed.address);
  started.push(address);
  return address;
}

/** The space hc itself holds for a terminal: what every client reads. */
function spaceInHc(address: string): unknown {
  const got: unknown = JSON.parse(hcOn("host", ["get", address, "--json"]));
  const labels = typeof got === "object" && got !== null ? Reflect.get(got, "labels") : undefined;
  return typeof labels === "object" && labels !== null ? Reflect.get(labels, "space") : undefined;
}

/** A second device: its own browser context (its own storage) on the same host. */
async function secondDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const settings = {
    mode: "loopback",
    relayUrl: "wss://relay-doriface.omo.dev",
    directUrl: "",
    hostId: "",
    loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
    token: E2E_TOKEN,
  };
  await context.addInitScript((value) => localStorage.setItem("doriface.connection", value), JSON.stringify(settings));
  return context.newPage();
}

test.afterEach(() => {
  for (const address of started.splice(0)) endAgent("host", address);
});

test("a space renamed from its menu shows the new name on another device at once, and hc holds it", async ({
  page,
  browser,
}) => {
  const [before, after] = [`rn395-a-${test.info().repeatEachIndex}`, `rn395-b-${test.info().repeatEachIndex}`];
  const shells = [startIn(before, "rn-one"), startIn(before, "rn-two")];
  const other = await secondDevice(browser);
  await Promise.all([page.goto("/"), other.goto("/")]);
  await expect(spaceRow(page, before)).toBeVisible({ timeout: 20_000 });
  await expect(spaceRow(other, before)).toBeVisible({ timeout: 20_000 });

  await spaceRow(page, before).hover();
  await sidebar(page)
    .getByRole("button", { name: `More for ${before}` })
    .click();
  await page.getByRole("menuitem", { name: "Rename space…" }).click();
  const dialog = page.getByRole("dialog", { name: `Rename ${before}` });
  const field = dialog.getByRole("textbox", { name: "Name" });
  await expect(field).toHaveValue(before);
  // A blank name is refused where it was typed, and nothing is written.
  await field.fill("   ");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog.getByText("A space needs a name.")).toBeVisible();
  expect(shells.map(spaceInHc)).toEqual([before, before]);

  await field.fill(`  ${after} `);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toBeHidden();
  await Promise.all([page, other].map((device) => expect(spaceRow(device, after)).toBeVisible({ timeout: 15_000 })));
  await Promise.all([page, other].map((device) => expect(spaceRow(device, before)).toHaveCount(0)));
  expect(shells.map(spaceInHc)).toEqual([after, after]);
  await other.context().close();
});

test("double-click edits a space's name in place: Esc puts it back, Enter commits it for every device", async ({
  page,
  browser,
}) => {
  const [before, after] = [`rn395-c-${test.info().repeatEachIndex}`, `rn395-d-${test.info().repeatEachIndex}`];
  // Started first, so it is the terminal in view: the double-click's first click opens the renamed space in a new tab.
  startIn(`${before}-shown`, "rn-shown");
  const shells = [startIn(before, "rn-three"), startIn(before, "rn-four")];
  const other = await secondDevice(browser);
  await Promise.all([page.goto("/"), other.goto("/")]);
  await expect(spaceRow(page, before)).toBeVisible({ timeout: 20_000 });
  await expect(spaceRow(other, before)).toBeVisible({ timeout: 20_000 });

  const input = sidebar(other).getByRole("textbox", { name: `Rename space ${before}` });
  await spaceRow(other, before).dblclick();
  await expect(input).toBeFocused();
  // The double-click's first click opened the space's terminal; once it starts, the field still has the keyboard.
  await expect(other.locator(`[data-terminal="${shells[0]}"][data-ready="true"]`)).toBeVisible({ timeout: 15_000 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(before);
  await input.fill("never-written");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(spaceRow(other, before)).toBeVisible();
  expect(shells.map(spaceInHc)).toEqual([before, before]);

  await spaceRow(other, before).dblclick();
  await expect(input).toBeFocused();
  await input.fill("");
  await input.press("Enter");
  await expect(sidebar(other).getByRole("alert")).toHaveText("A space needs a name.");
  await expect(input).toBeFocused();
  await input.fill(after);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await Promise.all([other, page].map((device) => expect(spaceRow(device, after)).toBeVisible({ timeout: 15_000 })));
  await Promise.all([other, page].map((device) => expect(spaceRow(device, before)).toHaveCount(0)));
  expect(shells.map(spaceInHc)).toEqual([after, after]);
  await other.context().close();
});
