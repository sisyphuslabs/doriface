import type { Page } from "@playwright/test";
import { E2E_HOST_PORT } from "./config.ts";
import { coreDoc, setCoreDoc } from "./core-doc.ts";
import { expect, test } from "./fixtures.ts";
import { key, keysBar, openPhoneTerminal, PHONE } from "./phone-key-bar.ts";

test.use({ serviceWorkers: "block", ...PHONE });

const HOST_INFO_DOC = "doriface-host";

// A darwin host, faked without touching the shared e2e host: this page's reads of the host's document are pointed at
// a document of the same length that says darwin. The rest of the hc stream passes through as it is.
const FAKED_DOC = `${HOST_INFO_DOC.slice(0, -1)}x`;

async function readDarwinHost(page: Page): Promise<void> {
  setCoreDoc(FAKED_DOC, { v: 1, os: "darwin" });
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

test("the e2e host reports linux on its core, and its key bar has no Command key", async ({ page }) => {
  expect(coreDoc(HOST_INFO_DOC)).toMatchObject({ value: { v: 1, os: "linux" } });
  await openPhoneTerminal(page);
  await expect(key(page, "Control")).toBeVisible();
  await expect(keysBar(page).getByRole("button", { name: "Command", exact: true })).toHaveCount(0);
});

test("a host that reports darwin gets the Command key, and cmd then v pastes the device clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await readDarwinHost(page);
  const terminal = await openPhoneTerminal(page);
  const cmd = key(page, "Command");
  await expect(cmd).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => navigator.clipboard.writeText("echo mac-$((6+1))"));
  await cmd.click();
  await expect(cmd).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("v");
  await expect(terminal).toContainText("echo mac-$((6+1))", { timeout: 10_000 });
  await page.keyboard.type("\r");
  await expect(terminal).toContainText("mac-7", { timeout: 10_000 });
});
