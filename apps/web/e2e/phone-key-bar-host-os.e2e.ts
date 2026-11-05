import type { Page } from "@playwright/test";
import { E2E_HOST_PORT } from "./config.ts";
import { coreDoc, setCoreDoc } from "./core-doc.ts";
import { expect, test } from "./fixtures.ts";
import { key, keysBar, openPhoneTerminal, PHONE } from "./phone-key-bar.ts";

test.use({ serviceWorkers: "block", ...PHONE });

const HOST_INFO_DOC = "doriface-host";

// A host OS, faked without touching the real host's document: this page's reads are pointed at
// a document of the same length that says the chosen OS. The rest of the hc stream passes through as it is.
const FAKED_DOC = `${HOST_INFO_DOC.slice(0, -1)}x`;

async function readHostOs(page: Page, os: "linux" | "darwin"): Promise<void> {
  setCoreDoc(FAKED_DOC, { v: 1, os });
  await page.routeWebSocket(`ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`, (socket) => {
    const host = socket.connectToServer();
    socket.onMessage((frame) => {
      const text = typeof frame === "string" ? frame : frame.toString("latin1");
      const read = `"name":"${HOST_INFO_DOC}"`;
      host.send(text.includes(read) ? Buffer.from(text.replace(read, `"name":"${FAKED_DOC}"`), "latin1") : frame);
    });
    host.onMessage((message) => socket.send(message));
  });
}

test("the e2e host reports its actual OS on its core, and its key bar matches", async ({ page }) => {
  await openPhoneTerminal(page);
  // The host writes its OS once a client opens a pipe (#306): this page's.
  await expect.poll(() => coreDoc(HOST_INFO_DOC)).toMatchObject({ value: { v: 1, os: process.platform } });
  await expect(key(page, "Control")).toBeVisible();
  await expect(keysBar(page).getByRole("button", { name: "Command", exact: true })).toHaveCount(
    process.platform === "darwin" ? 1 : 0,
  );
});

for (const os of ["linux", "darwin"] as const) {
  test(`a host that reports ${os} gets its matching keys and paste chord`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await readHostOs(page, os);
    const terminal = await openPhoneTerminal(page);
    const cmd = keysBar(page).getByRole("button", { name: "Command", exact: true });
    await expect(cmd).toHaveCount(os === "darwin" ? 1 : 0);
    await page.evaluate(() => navigator.clipboard.writeText("echo clipboard-$((6+1))"));
    const modifier = key(page, os === "darwin" ? "Command" : "Control");
    await modifier.click();
    await expect(modifier).toHaveAttribute("aria-pressed", "true");
    if (os === "linux") await key(page, "Shift").click();
    await page.keyboard.type("v");
    await expect(modifier).toHaveAttribute("aria-pressed", "false");
    await expect(terminal).toContainText("echo clipboard-$((6+1))", { timeout: 10_000 });
    await page.keyboard.type("\r");
    await expect(terminal).toContainText("clipboard-7", { timeout: 10_000 });
  });
}
