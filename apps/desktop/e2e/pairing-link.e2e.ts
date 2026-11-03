import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { base64urlEncode, buildPairingUrl, hostIdOf } from "@doriface/crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scratchHcSession } from "./hc-session.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env["DORIFACE_E2E_EXECUTABLE"];
const attachAfterFirstLoad = join(appDir, "e2e", "attach-after-first-load.ts");

const signPub = new Uint8Array(32).map((_, index) => (index * 37 + 11) % 256);
const linkSecret = new Uint8Array(32).fill(7);
const SECRET = base64urlEncode(linkSecret);
const PAIR_URL = buildPairingUrl({
  webOrigin: "https://doriface.omo.dev",
  hostId: hostIdOf(signPub),
  noiseStaticPub: new Uint8Array(32).map((_, index) => (index * 53 + 7) % 256),
  signPub,
  linkSecret,
  relayUrl: "wss://relay.invalid",
});
const FRAGMENT = PAIR_URL.slice(PAIR_URL.indexOf("#"));

interface Scratch {
  readonly hc: ReturnType<typeof scratchHcSession>;
  readonly profile: string;
}
let scratch: Scratch | undefined;
let launched: ElectronApplication | undefined;

test.beforeAll(async () => {
  const hc = scratchHcSession();
  const profile = mkdtempSync(join(tmpdir(), "dd-pairing-"));
  scratch = { hc, profile };
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...hc.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const args = [...(executablePath === undefined ? [appDir] : []), `--user-data-dir=${profile}`];
  launched = await electron.launch({
    ...(executablePath === undefined ? { args } : { executablePath: attachAfterFirstLoad, args }),
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

const historyWithSecret = (): Promise<string[]> =>
  running().evaluate(({ BrowserWindow }, secret) => {
    const entries = BrowserWindow.getAllWindows()[0]?.webContents.navigationHistory.getAllEntries() ?? [];
    return entries.map((entry) => entry.url).filter((url) => url.includes(secret));
  }, SECRET);

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

test("a pairing link's secret leaves the location and the history of the desktop window", async () => {
  const page = await appPage();
  await page.goto(`${originOf(page)}/pair${FRAGMENT}`);
  await expect(page.getByRole("button", { name: "They match" })).toBeVisible();
  expect(page.url()).not.toContain(SECRET);
  expect(await historyWithSecret()).toEqual([]);
});
