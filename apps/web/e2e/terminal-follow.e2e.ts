import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, openNewTerminalBehindLatency, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** More lines than the view holds, so a terminal that stopped following cannot show a batch's last line by chance. */
const BATCH = 60;

test("a terminal at the bottom keeps following output while the window resizes", async ({ page }) => {
  // Each batch of output waits for its gate file, so every resize lands with output still to come, however slow this
  // page is: the check below then waits on one state, the newest line drawn and in view, not on a line passing by.
  const gates = mkdtempSync(join(tmpdir(), "doriface-follow-"));
  try {
    const { terminal } = await openNewTerminalBehindLatency(page, 300);
    // Sent through hc, not typed: typed input would scroll the terminal to the bottom itself, and typing a long line
    // on a starved page can take longer than the whole test.
    hcOn("host", [
      "send",
      (await terminal.getAttribute("data-terminal")) ?? "",
      `for b in 1 2 3 4 5; do until [ -e ${gates}/$b ]; do sleep 0.05; done; ` +
        `for i in $(seq 1 ${BATCH}); do printf 'batch%d-%03d\\n' $b $i; done; done`,
    ]);
    const newest = (batch: number) =>
      terminal.locator(".term-row").filter({ hasText: new RegExp(String.raw`^batch${batch}-0*${BATCH}\s*$`) });
    const release = (batch: number): void => writeFileSync(join(gates, String(batch)), "");

    release(1);
    await expect(newest(1)).toBeInViewport({ timeout: 15_000 });
    const resizes = [
      [2, 820],
      [3, 1280],
      [4, 820],
      [5, 1280],
    ] as const;
    await resizes.reduce<Promise<void>>(async (previous, [batch, width]) => {
      await previous;
      await page.setViewportSize({ width, height: 800 });
      release(batch);
      await expect(newest(batch)).toBeInViewport({ timeout: 15_000 });
    }, Promise.resolve());
  } finally {
    rmSync(gates, { recursive: true, force: true });
  }
});
