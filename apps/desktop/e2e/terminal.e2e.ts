import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scratchHcSession } from "./hc-session.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env["DORIFACE_E2E_EXECUTABLE"];
const hc = scratchHcSession();
/** A scratch profile, so the app always starts on first run with nothing saved. */
const profile = mkdtempSync(join(tmpdir(), "dd-profile-"));
let launched: ElectronApplication | undefined;

test.beforeAll(async () => {
  const env = Object.fromEntries(
    // A plain shell and prompt keep the screenshot free of this machine's user, paths and shell theme.
    Object.entries({ ...process.env, ...hc.env, SHELL: "/bin/sh", PS1: "$ ", ENV: "" }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const args = [`--user-data-dir=${profile}`];
  launched = await electron.launch({
    ...(executablePath === undefined ? { args: [appDir, ...args] } : { executablePath, args }),
    env,
  });
});

test.afterAll(async () => {
  try {
    await launched?.close();
  } finally {
    await hc.dispose();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("Use this computer attaches a live terminal that echoes", async () => {
  if (launched === undefined) throw new Error("the app did not launch");
  const page = await launched.firstWindow();
  await page.getByRole("button", { name: "Use this computer" }).click();
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click({ timeout: 30_000 });
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toContainText("$", { timeout: 30_000 });
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("echo doriface-ok");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(/doriface-ok[\s\S]*doriface-ok/, { timeout: 15_000 });
  const screenshot = test.info().outputPath("terminal.png");
  await page.screenshot({ path: screenshot });
  console.log(`screenshot ${screenshot}`);
});
