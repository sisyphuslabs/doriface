// Visual QA captures of the permission banner in the real app (#192): CAPTURE=1 bunx playwright test approval-capture
import { devices, type Page } from "@playwright/test";
import { join } from "node:path";
import { agentRow } from "./agents.ts";
import { type AskingAgent, startAskingAgent } from "./approval-agent.ts";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { expect, test } from "./fixtures.ts";

const OUT = join(import.meta.dirname, "../../../docs/design/app");
const CONNECTION = JSON.stringify({
  mode: "loopback",
  relayUrl: "",
  directUrl: "",
  hostId: "",
  loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
  token: E2E_TOKEN,
});

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ page: async ({ page }, use) => use(page), serviceWorkers: "block" });

const contextFor = (width: "1440" | "390") =>
  width === "1440" ? { viewport: { width: 1440, height: 900 } } : devices["iPhone 14"];

async function openAsking(page: Page, agent: AskingAgent, name: string): Promise<void> {
  await expect(agentRow(page, name, false)).toBeVisible({ timeout: 20_000 });
  await agentRow(page, name, false).click();
  await expect(page.locator(`[data-approval="${agent.address}"]`)).toContainText("touch probe-a.txt", {
    timeout: 15_000,
  });
}

for (const width of ["1440", "390"] as const) {
  for (const theme of ["day", "night"] as const) {
    test(`approval ${width} ${theme}`, async ({ browser }) => {
      const { defaultBrowserType: _browser, ...use } = { defaultBrowserType: "chromium", ...contextFor(width) };
      const context = await browser.newContext({ ...use, colorScheme: theme === "day" ? "light" : "dark" });
      await context.addInitScript(
        ([chosen, connection]) => {
          localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
          localStorage.setItem("doriface.connection", connection);
        },
        [theme, CONNECTION] as const,
      );
      const agents: AskingAgent[] = [];
      const shoot = async (page: Page, state: string) => {
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(OUT, `approval-${state}-${width}-${theme}.png`), animations: "disabled" });
      };
      try {
        const page = await context.newPage();
        const waiting = `asks-cap-${crypto.randomUUID().slice(0, 6)}`;
        agents.push(startAskingAgent(waiting));
        const first = agents[0];
        if (first === undefined) throw new Error("no agent");
        await page.goto("/");
        await openAsking(page, first, waiting);
        const banner = page.locator(`[data-approval="${first.address}"]`);
        await shoot(page, "waiting");
        await banner.getByRole("button", { name: /^Allow/ }).click();
        await expect(banner).toContainText("from this device", { timeout: 10_000 });
        await shoot(page, "answered");

        const gone = `asks-cap-${crypto.randomUUID().slice(0, 6)}`;
        agents.push(startAskingAgent(gone));
        const second = agents[1];
        if (second === undefined) throw new Error("no agent");
        if (width === "390") await page.getByRole("button", { name: "Back to agents" }).click();
        await openAsking(page, second, gone);
        second.typeInTerminal("x");
        await expect.poll(second.keys, { timeout: 10_000 }).toEqual(["x"]);
        const staleBanner = page.locator(`[data-approval="${second.address}"]`);
        await staleBanner.getByRole("button", { name: /^Allow/ }).click();
        await expect(staleBanner).toContainText("The prompt went away.", { timeout: 10_000 });
        await shoot(page, "stale");
      } finally {
        for (const agent of agents) agent.end();
        await context.close();
      }
    });
  }
}
