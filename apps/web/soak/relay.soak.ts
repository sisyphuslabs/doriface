import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

// The relay soak (#403): pairs this browser with the soak's host by the link in SOAK_LINK_FILE, opens a terminal
// through the relay, then types and reads output for SOAK_MINUTES, measuring each keystroke's echo and recording every
// relay socket's opens and closes. The result goes to SOAK_RESULT as JSON before anything is asserted.
const LINK_FILE = process.env["SOAK_LINK_FILE"];
const MINUTES = Number(process.env["SOAK_MINUTES"] ?? 30);
const RESULT = process.env["SOAK_RESULT"] ?? "soak-result.json";
const CLIENT = process.env["SOAK_CLIENT"] ?? `${process.platform} chromium`;

test.skip(LINK_FILE === undefined, "needs SOAK_LINK_FILE, a pairing link from the soak's host");
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

/** A keystroke whose echo has not drawn by then counts as lost. */
const ECHO_TIMEOUT_MS = 10_000;
const BURST_TIMEOUT_MS = 60_000;
const BURST_EVERY = 20;
/** A person's pause between words: the soak is about a session over time, not throughput. */
const PACE_MS = 500;

interface SocketEvent {
  readonly kind: string;
  readonly type: "open" | "close";
  readonly at: number;
  readonly code?: number;
  readonly reason?: string;
  readonly clean?: boolean;
}

interface Probe {
  readonly token: string;
  lastKey?: number;
  doneAt?: number;
}

function trackSockets(): void {
  // Whether the page counts as visible, and how many animation frames it has drawn: the terminal draws only on frames.
  const visibility: { readonly at: number; readonly state: string }[] = [{ at: 0, state: document.visibilityState }];
  Object.defineProperty(window, "__soakVisibility", { value: visibility });
  document.addEventListener("visibilitychange", () =>
    visibility.push({ at: performance.now(), state: document.visibilityState }),
  );
  let frames = 0;
  const tick = (): void => {
    frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  Object.defineProperty(window, "__soakFrames", { get: () => frames });
  const events: SocketEvent[] = [];
  Object.defineProperty(window, "__soakSockets", { value: events });
  const Native = window.WebSocket;
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- addInitScript sends this function alone into the page
  const kindOf = (url: string): string =>
    new URL(url, location.href).pathname.replace(/\/v1\/(client|host)\/[^/]+/, "/v1/$1/:hostId");
  class Tracked extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const kind = kindOf(String(url));
      this.addEventListener("open", () => events.push({ kind, type: "open", at: performance.now() }));
      this.addEventListener("close", (event) =>
        events.push({
          kind,
          type: "close",
          at: performance.now(),
          code: event.code,
          reason: event.reason,
          clean: event.wasClean,
        }),
      );
    }
  }
  window.WebSocket = Tracked;
}

/**
 * Arms a probe for `token`: the time of the last keydown, and the time the token is first on the terminal's visible
 * rows. Only the rows on screen are read, so a long scrollback costs the measurement nothing.
 */
const arm = (page: Page, token: string): Promise<void> =>
  page.evaluate((wanted) => {
    const probe: Probe = { token: wanted };
    Reflect.set(window, "__soakProbe", probe);
    const terminals = document.querySelectorAll("[data-terminal]");
    const terminal = terminals[terminals.length - 1];
    if (terminal === undefined) throw new Error("no terminal on the page");
    const onKey = (event: KeyboardEvent): void => void (probe.lastKey = event.timeStamp);
    document.addEventListener("keydown", onKey, true);
    // Joined, so a token the shell wrapped onto the next row still counts.
    const shown = (): boolean =>
      Array.from(terminal.querySelectorAll(".term-row:not(.term-scrollback-row)"), (row) => row.textContent ?? "")
        .join("")
        .includes(wanted);
    const observer = new MutationObserver(() => {
      if (!shown()) return;
      probe.doneAt = performance.now();
      observer.disconnect();
      document.removeEventListener("keydown", onKey, true);
    });
    observer.observe(terminal, { subtree: true, childList: true, characterData: true });
  }, token);

/** The last terminal's rows on screen, top to bottom, trailing blanks trimmed. */
const screenRows = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const terminals = document.querySelectorAll("[data-terminal]");
    const terminal = terminals[terminals.length - 1];
    if (terminal === undefined) return [];
    return Array.from(terminal.querySelectorAll(".term-row:not(.term-scrollback-row)"), (row) =>
      (row.textContent ?? "").trimEnd(),
    );
  });

const lastRows = async (page: Page, count: number): Promise<string[]> =>
  (await screenRows(page)).filter((row) => row !== "").slice(-count);

/** Whether the row the shell is editing (the last non-blank one) still shows `token`, within `timeout`. */
const erased = (page: Page, token: string, timeout: number): Promise<boolean> =>
  page
    .waitForFunction(
      (wanted) => {
        const terminals = document.querySelectorAll("[data-terminal]");
        const rows = Array.from(
          terminals[terminals.length - 1]?.querySelectorAll(".term-row:not(.term-scrollback-row)") ?? [],
          (row) => (row.textContent ?? "").trimEnd(),
        ).filter((row) => row !== "");
        return !(rows.at(-1) ?? "").includes(wanted);
      },
      token,
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );

async function settle(page: Page, timeout: number): Promise<number | undefined> {
  const done = await page
    .waitForFunction(() => (Reflect.get(window, "__soakProbe") as Probe | undefined)?.doneAt !== undefined, null, {
      timeout,
    })
    .then(
      () => true,
      () => false,
    );
  if (!done) return undefined;
  return page.evaluate(() => {
    const probe = Reflect.get(window, "__soakProbe") as Probe;
    return (probe.doneAt ?? 0) - (probe.lastKey ?? 0);
  });
}

/** Nearest-rank percentile of sorted values. */
const percentile = (sorted: readonly number[], p: number): number | null =>
  sorted.length === 0 ? null : (sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null);

const round = (value: number | null): number | null => (value === null ? null : Math.round(value * 10) / 10);

const summary = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? null),
  };
};

async function pairAndOpen(page: Page, link: string): Promise<Locator> {
  await page.goto(`/pair${new URL(link).hash}`);
  await page.getByRole("button", { name: "They match" }).click({ timeout: 60_000 });
  await expect(page.getByText("This device now reaches the host through the relay")).toBeVisible({ timeout: 120_000 });
  await page
    .getByRole("link", { name: "Open terminals" })
    .or(page.getByRole("button", { name: "Open terminals" }))
    .click();
  await page.getByRole("button", { name: "New tab", exact: true }).click({ timeout: 120_000 });
  const terminal = page.locator("[data-terminal]").last();
  await terminal.getByRole("textbox").focus();
  // Whatever the host's prompt looks like, the shell is ready once it runs a command.
  await arm(page, "soak-ready-2");
  await page.keyboard.type("echo soak-ready-$((1+1))");
  await page.keyboard.press("Enter");
  const ready = await settle(page, 120_000);
  expect(ready, `the shell answers; on screen:\n${(await lastRows(page, 12)).join("\n")}`).not.toBeUndefined();
  return terminal;
}

test("relay soak: typing and output through the relay", async ({ page }) => {
  const link = readFileSync(LINK_FILE ?? "", "utf8").trim();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(trackSockets);
  await pairAndOpen(page, link);

  const startedAt = await page.evaluate(() => performance.now());
  const deadline = Date.now() + MINUTES * 60_000;
  const echoes: number[] = [];
  /** Per sample: seconds into the soak, echo ms (null when lost), page visible (1/0), animation frames since the last sample. */
  const timeline: [number, number | null, number, number][] = [];
  let framesBefore = 0;
  const bursts: number[] = [];
  let lost = 0;
  let burstsLost = 0;
  let eraseFailures = 0;
  /** What the screen showed at the first few lost echoes and failed erases, to tell the shell from the client. */
  const diagnostics: { readonly atS: number; readonly what: string; readonly rows: string[] }[] = [];
  const note = async (what: string): Promise<void> => {
    if (diagnostics.length >= 6) return;
    const atS = Math.round(((await page.evaluate(() => performance.now())) - startedAt) / 1000);
    diagnostics.push({ atS, what, rows: await lastRows(page, 6) });
  };

  const sample = async (i: number): Promise<void> => {
    if (Date.now() > deadline) return;
    const token = `zq${i.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await arm(page, token);
    await page.keyboard.type(token);
    const ms = await settle(page, ECHO_TIMEOUT_MS);
    const now = await page.evaluate(() => ({
      at: performance.now(),
      visible: document.visibilityState === "visible" ? 1 : 0,
      frames: Reflect.get(window, "__soakFrames") as number,
    }));
    const at = Math.round((now.at - startedAt) / 1000);
    timeline.push([at, ms === undefined ? null : Math.round(ms * 10) / 10, now.visible, now.frames - framesBefore]);
    framesBefore = now.frames;
    if (ms === undefined) {
      lost += 1;
      await note(`echo of ${token} lost`);
    } else echoes.push(ms);
    await Array.from(token).reduce((typed) => typed.then(() => page.keyboard.press("Backspace")), Promise.resolve());
    if (!(await erased(page, token, 5_000))) {
      eraseFailures += 1;
      await note(`Backspace left ${token}`);
      // Ctrl+C drops the line in any shell, so one failed erase does not spoil every later sample.
      await page.keyboard.press("Control+c");
      await erased(page, token, 5_000);
    }
    if (i % BURST_EVERY === BURST_EVERY - 1) {
      const end = `soak-${i + 1_000_000}`;
      await arm(page, end);
      await page.keyboard.type(`seq 1 3000; echo soak-$((${i}+1000000))`);
      await page.keyboard.press("Enter");
      const burst = await settle(page, BURST_TIMEOUT_MS);
      if (burst === undefined) burstsLost += 1;
      else bursts.push(burst);
    }
    await page.waitForTimeout(PACE_MS);
    return sample(i + 1);
  };
  await sample(0);

  const sockets = await page.evaluate(() => Reflect.get(window, "__soakSockets") as SocketEvent[]);
  const during = sockets.filter((event) => event.at >= startedAt);
  const closes = during
    .filter((event) => event.type === "close")
    .map(({ kind, code, reason, clean, at }) => ({
      kind,
      code,
      reason,
      clean,
      atS: Math.round((at - startedAt) / 1000),
    }));
  const opens = during.filter((event) => event.type === "open");
  const result = {
    client: CLIENT,
    platform: process.platform,
    userAgent: await page.evaluate(() => navigator.userAgent),
    minutes: MINUTES,
    echo: { ...summary(echoes), lost },
    eraseFailures,
    diagnostics,
    bursts: { ...summary(bursts), lost: burstsLost, lines: 3000 },
    sockets: {
      opensDuringSoak: opens.map(({ kind, at }) => ({ kind, atS: Math.round((at - startedAt) / 1000) })),
      closes,
    },
    visibility: (
      await page.evaluate(() => Reflect.get(window, "__soakVisibility") as { at: number; state: string }[])
    ).map(({ at, state }) => ({ state, atS: Math.round((at - startedAt) / 1000) })),
    launchArgs: process.env["SOAK_CHROMIUM_ARGS"] ?? "",
    reconnects: opens.filter((event) => event.kind.startsWith("/v1/client/")).length,
    pageErrors,
    consoleErrors: { count: consoleErrors.length, first: consoleErrors.slice(0, 20) },
    timeline,
  };
  writeFileSync(RESULT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, timeline: `${timeline.length} samples` }));

  expect(echoes.length, "keystrokes measured").toBeGreaterThan(0);
  expect(closes, "relay sockets closed during the soak").toEqual([]);
  expect(pageErrors, "page errors").toEqual([]);
});
