import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { scratchHcSession } from "./hc-session.ts";
import { appArgs, packagedExecutable as executablePath } from "./launch.ts";

/** A scratch hc session and a scratch profile, made only when the tests run (not on --list). */
interface Scratch {
  readonly hc: ReturnType<typeof scratchHcSession>;
  readonly profile: string;
  readonly shellHome: string;
}
let scratch: Scratch | undefined;
let launched: ElectronApplication | undefined;

test.beforeAll(async () => {
  const hc = scratchHcSession();
  // A scratch profile, so the app always starts on first run with nothing saved.
  const profile = mkdtempSync(join(tmpdir(), "dd-profile-"));
  // A shell that starts clean: bash without profile or rc files (macOS's /etc/bashrc sets a prompt with
  // the host and user) and a scratch HOME, so the screenshot shows nothing of this machine.
  const shellHome = mkdtempSync(join(tmpdir(), "dd-shell-"));
  writeFileSync(join(shellHome, "clean-shell"), "#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n", { mode: 0o755 });
  scratch = { hc, profile, shellHome };
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...hc.env,
      // A bare name found on PATH, so the terminal title is "clean-shell" rather than a scratch path.
      SHELL: "clean-shell",
      PATH: `${shellHome}:${process.env["PATH"] ?? ""}`,
      HOME: shellHome,
      PS1: "$ ",
      ENV: "",
      BASH_SILENCE_DEPRECATION_WARNING: "1",
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const args = [`--user-data-dir=${profile}`];
  launched = await electron.launch({
    ...(executablePath === undefined ? { args: appArgs(args) } : { executablePath, args }),
    env,
  });
});

test.afterAll(async () => {
  try {
    await launched?.close();
  } finally {
    if (scratch !== undefined) {
      await scratch.hc.dispose();
      rmSync(scratch.profile, { recursive: true, force: true });
      rmSync(scratch.shellHome, { recursive: true, force: true });
    }
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
  // The pane title comes from the running program's argv (clean-shell, then bash once it execs);
  // wait until it is set and names no path before reading what the window shows.
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(/^[^/]+$/, { timeout: 10_000 });
  // The whole window, so the status bar's machine name counts as well as the prompt.
  const shown = (await page.locator("body").textContent()) ?? "";
  const host = hostname().split(".")[0] ?? "";
  expect(host).not.toBe("");
  expect(shown.toLowerCase()).not.toContain(host.toLowerCase());
  expect(shown).not.toContain(userInfo().username);
  if (scratch === undefined) throw new Error("the scratch shell home was not created");
  expect(shown).not.toContain(scratch.shellHome);
  const screenshot = test.info().outputPath("terminal.png");
  await page.screenshot({ path: screenshot });
  console.log(`screenshot ${screenshot}`);
});
