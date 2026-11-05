import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// A timing bound for the CJK scroll stall (#286), measured min of N on an otherwise idle host: PERF=1 bunx playwright
// test terminal-cjk-scroll-perf --workers=1. Beside seven other workers every step is slow, so it runs on its own.
test.skip(process.env["PERF"] !== "1", "the perf bound runs only with PERF=1, on its own");

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

/** Lines of `count` distinct characters from `from` on, 40 to a line. */
function distinct(from: number, count: number): string {
  const chars = Array.from({ length: count }, (_, index) => String.fromCodePoint(from + index));
  const lines = Array.from({ length: Math.ceil(count / 40) }, (_, line) =>
    chars.slice(line * 40, line * 40 + 40).join(""),
  );
  return `${lines.join("\n")}\n`;
}

/** One wheel step up; the longest task it caused, in ms (0 when no task ran past 50 ms). */
async function wheelStep(page: Page): Promise<number> {
  await page.evaluate(() => {
    const tasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    });
    observer.observe({ type: "longtask" });
    Object.assign(window, { stepTasks: tasks, stepObserver: observer });
  });
  await page.mouse.wheel(0, -600);
  // Two frames: the one that handles the wheel and draws the rows it reveals, and one after it.
  return page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const { stepTasks, stepObserver } = window as unknown as {
              stepTasks: number[];
              stepObserver: PerformanceObserver;
            };
            for (const entry of stepObserver.takeRecords()) stepTasks.push(entry.duration);
            stepObserver.disconnect();
            resolve(Math.max(0, ...stepTasks));
          }),
        ),
      ),
  );
}

/**
 * One run: prints 20 lines of distinct Hangul and 40 of distinct ideographs, more than a screen and the rows a wheel step
 * reveals, from ranges no other run or repeat used (the browser's fallback lookups outlive the page, so a reused
 * character would already be resolved). It waits for the idle layout of the output, then scrolls back. Its score is the
 * longest task of its slowest wheel step.
 */
async function run(page: Page, round: number): Promise<{ readonly worst: number; readonly steps: readonly number[] }> {
  const slot = test.info().repeatEachIndex * 3 + round;
  const file = join(mkdtempSync(join(tmpdir(), "cjk-scroll-")), "cjk.txt");
  writeFileSync(file, distinct(0xac00 + slot * 800, 800) + distinct(0x4e00 + slot * 1600, 1600));
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`clear; cat ${file}; echo DONE-$((${round}+1))`);
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".term-row").filter({ hasText: `DONE-${round + 1}` })).not.toHaveCount(0, {
    timeout: 60_000,
  });
  // The output's characters are laid out in idle time; the steps below come after that, as a reader's scroll would.
  await expect(page.locator("[data-glyph-warmup]")).toHaveCount(0, { timeout: 300_000 });
  const box = await terminal.boundingBox();
  if (box === null) throw new Error("the terminal has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const steps: number[] = [];
  for (let step = 0; step < 4; step++) {
    // oxlint-disable-next-line no-await-in-loop -- each step scrolls on from where the previous one left the view
    steps.push(await wheelStep(page));
  }
  return { worst: Math.max(...steps), steps };
}

/**
 * A step over 29 rows of characters the page has not laid out took over a second before #286 (about a millisecond per
 * character on Linux); with them laid out in idle time it takes tens of ms on an idle host and under 100 on a loaded one.
 */
const BOUND_MS = 250;

test("scrolling back over a long scrollback of distinct CJK characters keeps every wheel step far under a second (#286)", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  await page.goto("/");
  // Min of N runs: a run slowed by another process on the host is not the code's cost; the fastest run is.
  const runs: { worst: number; steps: readonly number[] }[] = [];
  for (let round = 0; round < 3; round++) {
    // oxlint-disable-next-line no-await-in-loop -- each run opens its own terminal after the previous one
    runs.push(await run(page, round));
  }
  const report = runs.map(({ steps }) => steps.map(Math.round).join("/")).join(", ");
  // The numbers behind the bound, in every run's log, passing or not.
  console.log(`CJK wheel steps (ms, per run): ${report}`);
  expect(
    Math.min(...runs.map(({ worst }) => worst)),
    `longest task per wheel step, per run: ${report} ms`,
  ).toBeLessThanOrEqual(BOUND_MS);
});
