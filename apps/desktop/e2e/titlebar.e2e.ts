import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRAFFIC_LIGHTS } from "../src/config/window.ts";
import { scratchHcSession } from "./hc-session.ts";
import { appArgs, packagedExecutable as executablePath } from "./launch.ts";

test.skip(process.platform !== "darwin", "the hidden-inset titlebar and its window buttons exist only on macOS");

interface Scratch {
  readonly hc: ReturnType<typeof scratchHcSession>;
  readonly profile: string;
  readonly shellHome: string;
}
let scratch: Scratch | undefined;
let launched: ElectronApplication | undefined;

test.beforeAll(async () => {
  const hc = scratchHcSession();
  const profile = mkdtempSync(join(tmpdir(), "dd-titlebar-"));
  const shellHome = mkdtempSync(join(tmpdir(), "dd-titlebar-shell-"));
  writeFileSync(join(shellHome, "clean-shell"), "#!/bin/sh\nexec /bin/sh -i\n", { mode: 0o755 });
  scratch = { hc, profile, shellHome };
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...hc.env,
      SHELL: "clean-shell",
      PATH: `${shellHome}:${process.env["PATH"] ?? ""}`,
      HOME: shellHome,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const args = [`--user-data-dir=${profile}`];
  launched = await electron.launch({
    ...(executablePath === undefined ? { args: appArgs(args) } : { executablePath, args: appArgs(args) }),
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

const running = (): ElectronApplication => {
  if (launched === undefined) throw new Error("the app did not launch");
  return launched;
};

/** Every control and every piece of text drawn where the window buttons sit. */
function underWindowButtons(page: Page): Promise<string[]> {
  return page.evaluate((lights) => {
    const controls = 'a, button, input, select, textarea, [role="tab"], [role="button"], [tabindex]';
    const hits: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const text = element.childElementCount === 0 && (element.textContent ?? "").trim() !== "";
      if (!text && !element.matches(controls)) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || getComputedStyle(element).visibility === "hidden") continue;
      const overlaps =
        box.left < lights.x + lights.width &&
        lights.x < box.right &&
        box.top < lights.y + lights.height &&
        lights.y < box.bottom;
      if (overlaps)
        hits.push(`${element.tagName.toLowerCase()} "${(element.textContent ?? element.ariaLabel ?? "").trim()}"`);
    }
    return hits;
  }, TRAFFIC_LIGHTS);
}

const insetVariable = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--titlebar-inset-start").trim());

test("nothing sits under the window buttons, in every state and size, and full screen drops the inset", async () => {
  const app = running();
  const page = await app.firstWindow();
  await page.waitForSelector("#root > *");
  const position = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getWindowButtonPosition(),
  );
  expect(position).toEqual({ x: TRAFFIC_LIGHTS.x, y: TRAFFIC_LIGHTS.y });
  await expect.poll(() => insetVariable(page)).not.toBe("");

  const sizes = [
    { width: 1470, height: 956 },
    { width: 1280, height: 800 },
  ] as const;
  const checkAt = async (state: string, size: (typeof sizes)[number]): Promise<void> => {
    await app.evaluate(
      ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]?.setContentSize(bounds.width, bounds.height),
      size,
    );
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size.width);
    expect(await underWindowButtons(page), `${state} at ${size.width}x${size.height}`).toEqual([]);
  };
  const check = async (state: string): Promise<void> => {
    for (const size of sizes) {
      // oxlint-disable-next-line no-await-in-loop -- one window: each size is applied and read before the next
      await checkAt(state, size);
    }
  };

  await check("first run");
  await page.getByRole("button", { name: "Use this computer" }).click();
  await expect(page.getByRole("complementary", { name: "Workspace" })).toBeVisible({ timeout: 30_000 });
  await check("workspace with the sidebar");
  const header = await page.locator("aside [data-titlebar]").first().boundingBox();
  const buttons = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getWindowButtonPosition(),
  );
  expect(header).not.toBeNull();
  expect(buttons).toBeDefined();
  const headerCentre = (header?.y ?? 0) + (header?.height ?? 0) / 2;
  const buttonsCentre = (buttons?.y ?? 0) + TRAFFIC_LIGHTS.height / 2;
  expect(
    Math.abs(buttonsCentre - headerCentre),
    `buttons centred at ${buttonsCentre}, header at ${headerCentre}`,
  ).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.getByRole("complementary", { name: "Workspace" })).toBeHidden();
  await check("workspace with the sidebar hidden");
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(page).toHaveURL(/\/settings$/);
  await check("settings");

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit("enter-full-screen"));
  await expect.poll(() => insetVariable(page)).toBe("");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit("leave-full-screen"));
  await expect.poll(() => insetVariable(page)).not.toBe("");
});
