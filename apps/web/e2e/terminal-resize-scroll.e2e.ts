import type { Locator, Page } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { seedLayout } from "./layout-doc.ts";
import { hcOn } from "./machine-switch.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const LINES = 5000;

/**
 * An agent's transcript as pi-tui (omo, senpi) and Claude Code draw it outside a multiplexer: on every width change the
 * whole transcript again, as one synchronized update (DECSET 2026) that clears the screen and the scrollback first. A
 * native terminal swaps it in at once, and so must the view (#757). Each finished frame leaves a marker file.
 */
const AGENT = String.raw`stty -echo
drawn=0
frame() {
  cols=$(tput cols)
  printf '\033[?2026h\033[?7l\033[2J\033[H\033[3J'
  awk -v n=${LINES} -v c="$cols" 'BEGIN { fill = ""; for (k = 0; k < c - 10; k++) fill = fill "."
    for (i = 1; i <= n; i++) printf "\033[38;5;%dmrow %05d\033[0m %s%s", 240 + i % 10, i, fill, (i < n ? "\r\n" : "") }'
  printf '\033[?7h\033[?2026l'
  drawn=$((drawn + 1))
  : > "$DRAWN.$drawn"
}
trap frame WINCH
frame
while :; do sleep 1 & wait $!; done
`;

const started: string[] = [];
test.afterEach(() => {
  for (const address of started.splice(0)) hcOn("host", ["kill", address]);
});

/** Starts the agent on the core; `drawn(n)` tells whether it has written its n-th frame. */
function startAgent(dir: string): { readonly address: string; readonly drawn: (n: number) => boolean } {
  const script = join(dir, "agent.sh");
  const marker = join(dir, "drawn");
  writeFileSync(script, AGENT);
  const out = hcOn("host", ["run", "--bg", "--name", "resize-agent", "--", "env", `DRAWN=${marker}`, "bash", script]);
  const address = String((JSON.parse(out) as { address: string }).address);
  started.push(address);
  return { address, drawn: (n) => existsSync(`${marker}.${n}`) };
}

const terminalOf = (page: Page, address: string): Locator => page.locator(`[data-terminal="${address}"]`);

const fromBottom = (terminal: Locator): Promise<number> =>
  terminal.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);

/** The view at the bottom, its screen showing the transcript's last line. */
async function atLastLine(terminal: Locator): Promise<void> {
  await expect(terminal.locator(".term-row:not(.term-scrollback-row)").last()).toContainText(
    `row ${String(LINES).padStart(5, "0")}`,
    { timeout: 30_000 },
  );
  await expect.poll(() => fromBottom(terminal)).toBeLessThan(5);
}

interface Sample {
  readonly away: number;
  /** The newest transcript line the screen shows (the rest of a reflowed line shows none); 0 for none. */
  readonly newest: number;
}

/**
 * Samples the view on every animation frame until `change` is done: how far it is from the bottom, and the newest line
 * its screen shows. Each frame is what the user saw.
 */
async function sampleWhile(terminal: Locator, change: () => Promise<void>): Promise<Sample[]> {
  const samples = terminal.evaluate(
    (element) =>
      new Promise<Sample[]>((resolve) => {
        const seen: Sample[] = [];
        const record = (): void => {
          const rows = [...element.querySelectorAll(".term-row:not(.term-scrollback-row)")];
          const numbers = rows.map((row) => Number(/row (\d{5})/.exec(row.textContent ?? "")?.[1] ?? 0));
          seen.push({
            away: element.scrollHeight - element.clientHeight - element.scrollTop,
            newest: Math.max(0, ...numbers),
          });
          if (element.hasAttribute("data-e2e-stop-sampling")) {
            element.removeAttribute("data-e2e-stop-sampling");
            resolve(seen);
          } else requestAnimationFrame(record);
        };
        record();
      }),
  );
  await change();
  await terminal.evaluate((element) => element.setAttribute("data-e2e-stop-sampling", ""));
  return samples;
}

/** Every sampled frame stayed at the bottom on the transcript's last line. */
function expectFollowed(samples: readonly Sample[]): void {
  const off = samples.filter((sample) => sample.away >= 5 || sample.newest !== LINES);
  expect(samples.length).toBeGreaterThan(1);
  expect(off.slice(0, 5), `${off.length} of ${samples.length} frames left the transcript's end`).toEqual([]);
}

test("a following terminal stays on its last line through window resizes that redraw an agent's transcript", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "doriface-resize-scroll-"));
  try {
    const agent = startAgent(dir);
    seedLayout([{ id: "tb-757", name: "agent", root: [{ pane: "p1", terminal: agent.address }] }]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const terminal = terminalOf(page, agent.address);
    await atLastLine(terminal);
    const resize = async (width: number, frame: number): Promise<void> => {
      const samples = await sampleWhile(terminal, async () => {
        await page.setViewportSize({ width, height: 800 });
        await expect.poll(() => agent.drawn(frame), { timeout: 30_000 }).toBe(true);
        await atLastLine(terminal);
      });
      expectFollowed(samples);
    };
    await resize(960, 2);
    await resize(1280, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a following terminal stays on its last line while a split divider is dragged", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "doriface-resize-scroll-"));
  try {
    const agent = startAgent(dir);
    const shell = startShell("host", "resize-757-side");
    started.push(shell);
    seedLayout([
      {
        id: "tb-757",
        name: "split",
        root: [
          { pane: "p1", terminal: agent.address, weight: 0.6 },
          { pane: "p2", terminal: shell, weight: 0.4 },
        ],
      },
    ]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const terminal = terminalOf(page, agent.address);
    await atLastLine(terminal);
    const divider = page.locator('[role="separator"]').first();
    const line = await divider.boundingBox();
    if (line === null) throw new Error("no divider box");
    const [x, y] = [line.x + line.width / 2, line.y + line.height / 2];
    const samples = await sampleWhile(terminal, async () => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 240, y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => agent.drawn(2), { timeout: 30_000 }).toBe(true);
      await atLastLine(terminal);
    });
    expectFollowed(samples);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The text of the first row in view (the top one the scroll box shows), trimmed. */
const firstInView = (terminal: Locator): Promise<string> =>
  terminal.evaluate((element) => {
    const top = element.getBoundingClientRect().top + (parseFloat(getComputedStyle(element).paddingTop) || 0);
    const row = [...element.querySelectorAll(".term-row")].find(
      (each) => each.getBoundingClientRect().bottom > top + 1,
    );
    return (row?.textContent ?? "").trim();
  });

test("a terminal scrolled into its history keeps the same line at the top through a resize", async ({ page }) => {
  const shell = startShell("host", "resize-757-history");
  started.push(shell);
  seedLayout([{ id: "tb-757", name: "history", root: [{ pane: "p1", terminal: shell }] }]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const terminal = terminalOf(page, shell);
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  hcOn("host", ["send", shell, `seq -f 'line %05g' 1 ${LINES}`]);
  await expect(terminal.locator(".term-row:not(.term-scrollback-row)").filter({ hasText: /^line 05000/ })).toHaveCount(
    1,
    { timeout: 30_000 },
  );
  const rowHeight = await terminal.evaluate(
    (element) => element.querySelector(".term-row:not(.term-scrollback-row)")?.getBoundingClientRect().height ?? 0,
  );
  await terminal.evaluate((element, top) => {
    element.scrollTop = top;
  }, 1500 * rowHeight);
  await expect.poll(() => firstInView(terminal)).toMatch(/^line 015\d\d$/);
  const anchor = await firstInView(terminal);
  const box = (): Promise<string> => terminal.evaluate((element) => `${element.clientWidth}x${element.clientHeight}`);
  const resize = async (width: number, height: number): Promise<void> => {
    const before = await box();
    await page.setViewportSize({ width, height });
    await expect.poll(box).not.toBe(before);
    await expect.poll(() => firstInView(terminal)).toBe(anchor);
    expect(await fromBottom(terminal)).toBeGreaterThan(rowHeight);
  };
  await resize(900, 800);
  await resize(900, 600);
  await resize(1280, 800);
});
