// docs/getting-started.md, end to end through the hosted relay (#672): the desktop app starts this computer's host,
// Settings > Connections > Pair a device shows its QR code, and a fresh browser opens what that QR code encodes, the
// hosted web app's pair page, checks the key, pairs and types into a terminal on this computer. Nothing is stood in:
// the host dials relay-doriface.omo.dev and the page is doriface.omo.dev, as for a user. The release smoke runs it
// against the downloaded AppImage, and the From zero workflow against a packed build.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAIRING_WEB_ORIGIN } from "../src/config/deep-link.ts";
import { scratchHcSession } from "./hc-session.ts";
import { appDir, launchOptions, pressNewTab } from "./launch.ts";

test.skip(
  process.env["DORIFACE_HOSTED_RELAY_SMOKE"] !== "1",
  "pairs through the production relay and the hosted web app: runs only with DORIFACE_HOSTED_RELAY_SMOKE=1",
);
test.setTimeout(300_000);

const BROWSER_APP = join(appDir, "e2e", "browser-window.cjs");

let hc: ReturnType<typeof scratchHcSession> | undefined;
let profile: string | undefined;
let app: ElectronApplication | undefined;
let phone: ElectronApplication | undefined;

test.afterAll(async () => {
  await phone?.close().catch(() => undefined);
  await app?.close().catch(() => undefined);
  await hc?.dispose().catch(() => undefined);
  if (profile !== undefined) rmSync(profile, { recursive: true, force: true });
});

const originOf = (page: Page): string => {
  const url = new URL(page.url());
  return `${url.protocol}//${url.host}`;
};

test("a fresh browser pairs with the desktop app through the hosted relay and types into its terminal", async () => {
  hc = scratchHcSession();
  profile = mkdtempSync(join(tmpdir(), "dd-hosted-pair-"));
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...hc.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  app = await electron.launch({ ...launchOptions([`--user-data-dir=${profile}`]), env });
  const page = await app.firstWindow();
  const started = page.getByRole("button", { name: "Use this computer" });
  const workspace = page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first();
  await expect(started.or(workspace)).toBeVisible({ timeout: 120_000 });
  if (await started.isVisible()) await started.click();
  await expect(workspace).toBeVisible({ timeout: 120_000 });

  await page.goto(`${originOf(page)}/settings`);
  await page
    .getByRole("navigation", { name: "Settings", exact: true })
    .getByRole("button", { name: "Connections", exact: true })
    .or(page.getByRole("tab", { name: "Connections", exact: true }))
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Pair a device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pair a device" });
  await expect(dialog.getByRole("img", { name: "QR code for this computer's pairing link" })).toBeVisible({
    timeout: 120_000,
  });
  const link = await dialog.getByRole("textbox", { name: "Pairing link" }).inputValue();
  expect(link).toMatch(/&r=wss%3A%2F%2Frelay-doriface\.omo\.dev/);
  // The QR code encodes the hosted pair page with the same fragment as this link (apps/host/src/pair-link.ts).
  const scanned = `${PAIRING_WEB_ORIGIN}/pair${link.slice(link.indexOf("#"))}`;
  const fingerprint = (await dialog.locator("figure p").innerText()).replace(/\s/g, "");

  phone = await electron.launch({ args: [BROWSER_APP, scanned], env });
  const browser = await phone.firstWindow();
  await expect(browser.getByRole("heading", { name: "Check the host's key" })).toBeVisible({ timeout: 120_000 });
  await expect(browser.locator("body")).toContainText(fingerprint.slice(0, 4));
  await browser.getByRole("button", { name: "They match", exact: true }).click();
  await expect(browser.getByText("Paired", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(dialog.getByText(/^Paired with .+/)).toBeVisible({ timeout: 60_000 });

  await browser.getByRole("link", { name: "Open terminals" }).click();
  await pressNewTab(browser, { timeout: 120_000 });
  const terminal = browser.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toContainText("$", { timeout: 120_000 });
  await terminal.click({ timeout: 15_000 }).catch(() => undefined);
  await browser.keyboard.type("echo hosted-relay-$((40+2))");
  await browser.keyboard.press("Enter");
  await expect(terminal).toContainText("hosted-relay-42", { timeout: 60_000 });
});
