import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import electronBinary from "electron";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRAFFIC_LIGHTS } from "../src/config/window.ts";
import { scratchHcSession } from "./hc-session.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env["DORIFACE_E2E_EXECUTABLE"];
const attachAfterFirstLoad = join(appDir, "e2e", "attach-after-first-load.ts");

interface Scratch {
  readonly hc: ReturnType<typeof scratchHcSession>;
  readonly profile: string;
  readonly env: Record<string, string>;
}
let scratch: Scratch | undefined;
let launched: ElectronApplication | undefined;

const instanceArgs = (profile: string): readonly string[] =>
  executablePath === undefined ? [appDir, `--user-data-dir=${profile}`] : [`--user-data-dir=${profile}`];

test.beforeAll(async () => {
  const hc = scratchHcSession();
  const profile = mkdtempSync(join(tmpdir(), "dd-windows-"));
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...hc.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  scratch = { hc, profile, env };
  launched = await electron.launch({
    ...(executablePath === undefined
      ? { args: [...instanceArgs(profile)] }
      : { executablePath: attachAfterFirstLoad, args: [...instanceArgs(profile)] }),
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
    }
  }
});

const running = (): ElectronApplication => {
  if (launched === undefined) throw new Error("the app did not launch");
  return launched;
};

const windowCount = (): Promise<number> =>
  running().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

/** `URL.origin` is "null" for the app: scheme, so the origin is rebuilt from its parts. */
const originOf = (page: Page): string => {
  const url = new URL(page.url());
  return `${url.protocol}//${url.host}`;
};

async function appPage(): Promise<Page> {
  const page = await running().firstWindow();
  await page.waitForSelector("#root > *");
  return page;
}

test("a second launch, a dock click and every new-window click keep exactly one window", async () => {
  const page = await appPage();
  expect(await windowCount()).toBe(1);

  if (scratch === undefined) throw new Error("no scratch profile");
  const second = spawn(executablePath ?? String(electronBinary), [...instanceArgs(scratch.profile)], {
    env: scratch.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  second.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  second.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => second.once("exit", resolve));
  expect(code, output).toBe(0);
  expect(await windowCount()).toBe(1);

  await running().evaluate(({ app }) => app.emit("activate"));
  expect(await windowCount()).toBe(1);

  const origin = originOf(page);
  const clickOnce = async (path: string, index: number, modifier: "Meta" | "Shift" | "Control"): Promise<void> => {
    await page.goto(`${origin}${path}`);
    await page.waitForSelector("#root > *");
    await page
      .locator("a[href]")
      .nth(index)
      .click({ modifiers: [modifier] });
    expect(await windowCount(), `${modifier}-click on link ${index} of ${path}`).toBe(1);
  };
  const clickEveryLink = async (path: string): Promise<void> => {
    await page.goto(`${origin}${path}`);
    await page.waitForSelector("#root > *");
    const count = await page.locator("a[href]").count();
    const clicks = Array.from({ length: count }, (_, index) =>
      (["Meta", "Shift", "Control"] as const).map((modifier) => ({ index, modifier })),
    ).flat();
    for (const { index, modifier } of clicks) {
      // oxlint-disable-next-line no-await-in-loop -- one window: each click is counted before the next page load
      await clickOnce(path, index, modifier);
    }
  };
  for (const path of ["/", "/pair", "/settings"]) {
    // oxlint-disable-next-line no-await-in-loop -- one window: the paths are visited in turn
    await clickEveryLink(path);
  }

  await page.goto(`${origin}/`);
  await page.evaluate(() => window.open("/settings", "_blank"));
  await expect(page).toHaveURL(/\/settings$/);
  await page.evaluate(() => window.open("https://example.com/", "_blank"));
  expect(await windowCount()).toBe(1);
});

test("Escape and the close control leave Settings in the desktop window", async () => {
  const page = await appPage();
  const origin = originOf(page);
  await page.goto(`${origin}/`);
  await page.goto(`${origin}/settings`);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(`${origin}/`);

  await page.goto(`${origin}/settings`);
  const control = page.getByRole("button", { name: "Close settings" }).first();
  await expect(control).toBeVisible();
  if (process.platform === "darwin") {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    const clear =
      box === null ||
      box.x >= TRAFFIC_LIGHTS.x + TRAFFIC_LIGHTS.width ||
      box.y >= TRAFFIC_LIGHTS.y + TRAFFIC_LIGHTS.height;
    expect(clear, `close control at ${JSON.stringify(box)} sits under the window buttons`).toBe(true);
  }
  await control.click();
  await expect(page).toHaveURL(`${origin}/`);
  expect(await windowCount()).toBe(1);
});
