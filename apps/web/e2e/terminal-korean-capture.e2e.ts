import { devices, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { loadKoreanFonts } from "./korean-fonts.ts";

// Captures for #410: a TUI of bold, coloured, mixed Korean and Latin lines in the reported configuration (GeistMono
// Nerd Font Mono and IBM Plex Sans KR at 16 pt with 10% extra cell height), at both widths in both themes. Run with
// CAPTURE=1 and F410_DIR=<dir>; F410_STATE=before|after names the tree the shots came from.
test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ serviceWorkers: "block" });

// The first line clears the screen and the scrollback: these images are published, and the command that started the
// TUI carries this run's scratch directory. Nothing above the TUI's own first row survives into the capture.
const TUI = [
  "printf '\\033[H\\033[2J\\033[3J'",
  "printf '\\033[1;36m도리페이스 터미널\\033[0m \\033[2m— 렌더링 점검\\033[0m\\n'",
  "printf '──────────────────────────────────────────────\\n'",
  "printf '\\033[1;33m작업\\033[0m          \\033[1;32m완료\\033[0m    한글 렌더링 정상\\n'",
  "printf '\\033[1;33m연결\\033[0m          \\033[1;31m재시도\\033[0m  백오프 500ms\\n'",
  "printf '\\033[1;33m코드 검증\\033[0m     \\033[1;35m진행 중\\033[0m  앱스/웹/터미널\\n'",
  "printf '──────────────────────────────────────────────\\n'",
  "printf '가나다라 마바사 아자차카 타파하 — 모든 음절이 보입니다\\n'",
  "printf '\\033[1m굵은 한글\\033[0m 보통 한글 \\033[36m청록 한글\\033[0m \\033[33m노랑 한글\\033[0m\\n'",
  "printf 'Mixed Latin 한글 abcdef 1234 뷁힣똠쀼톴 혼합\\n'",
  "printf '\\033[1;34m$\\033[0m \\033[2m한글 렌더링 확인\\033[0m 완료\\n'",
].join("\n");
const SCRIPT = join(tmpdir(), "korean-tui.sh");
writeFileSync(SCRIPT, `${TUI}\n`);
const DIR = process.env["F410_DIR"] ?? ".";
const STATE = process.env["F410_STATE"] ?? "after";

async function print(page: Page, terminal: Locator): Promise<void> {
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`bash ${SCRIPT}`);
  await page.keyboard.press("Enter");
  // A short token: the phone width wraps the longer lines across rows.
  await expect(terminal).toContainText("타파하", { timeout: 30_000 });
}

async function useReportedFont(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page
    .getByRole("tab", { name: "Terminal", exact: true })
    .or(page.getByRole("button", { name: "Terminal", exact: true }))
    .first()
    .click();
  for (const [name, value] of [
    ["font-size", "16"],
    ["adjust-cell-height", "10%"],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- commit each setting before the next one
    await page.getByRole("textbox", { name, exact: true }).fill(value);
    // oxlint-disable-next-line no-await-in-loop -- commits this field
    await page.keyboard.press("Enter");
  }
  for (const name of ["Terminal Latin Fixture", "Terminal Korean Fixture"]) {
    // oxlint-disable-next-line no-await-in-loop -- font order is the setting under test
    await page.getByRole("button", { name: "Add font-family", exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop -- the field was just added
    await page.keyboard.type(name);
    // oxlint-disable-next-line no-await-in-loop -- commits this family
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Close settings" }).first().click();
  await expect(page.locator('[data-focused="true"] [data-terminal]')).toContainText("$", { timeout: 20_000 });
}

async function capture(terminal: Locator, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await terminal.screenshot({ path: join(DIR, `${STATE}-${name}.png`) });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`desktop ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

    test(`capture 1440 ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto("/");
      await loadKoreanFonts(page);
      await openNewTerminal(page);
      await useReportedFont(page);
      const focused = page.locator('[data-focused="true"] [data-terminal]');
      const address = await focused.getAttribute("data-terminal");
      if (address === null) throw new Error("no terminal address");
      const terminal = page.locator(`[data-terminal="${address}"]`);
      await print(page, terminal);
      await capture(terminal, `1440-${scheme}`);
    });
  });

  test.describe(`phone ${scheme}`, () => {
    const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
    test.use({ ...phone, colorScheme: scheme, serviceWorkers: "block" });

    test(`capture 390 ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      // The reported configuration is set at a desktop width, where Settings lays out, and the window is narrowed after
      // it is saved: the phone shot then shows that same stack wrapping, which is the half of the report a narrow
      // viewport exercises.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await loadKoreanFonts(page);
      await openNewTerminal(page);
      await useReportedFont(page);
      const focused = page.locator('[data-focused="true"] [data-terminal]');
      const address = await focused.getAttribute("data-terminal");
      if (address === null) throw new Error("no terminal address");
      await page.setViewportSize({ width: 390, height: 844 });
      const terminal = page.locator(`[data-terminal="${address}"]`);
      const agents = page.locator("button:has([data-floor='name']):has(time)");
      await expect(terminal.or(agents).first()).toBeVisible({ timeout: 20_000 });
      // A narrow window may list the agents instead of showing the terminal; its row opens it again.
      if (!(await terminal.isVisible())) await agents.first().click();
      await expect(terminal).toBeVisible({ timeout: 20_000 });
      await print(page, terminal);
      await capture(terminal, `390-${scheme}`);
    });
  });
}
