import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

const SIDEBAR = 'aside[aria-label="Workspace"]';

/** Records, from the page's very first script, every transition an arrival region starts: "tag:property". */
const recordArrivals = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, "__arrivals", { value: seen });
    document.addEventListener(
      "transitionstart",
      (event) => {
        if (event.target instanceof Element && event.target.classList.contains("motion-arrive")) {
          seen.push(`${event.target.tagName.toLowerCase()}:${event.propertyName}`);
        }
      },
      true,
    );
  });
const arrivals = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(window, "__arrivals");
    return Array.isArray(seen) ? seen.filter((entry): entry is string => typeof entry === "string").toSorted() : [];
  });

/**
 * Watches an element's opacity and transform every frame from now until it has appeared, run an animation and has
 * none left running, so the last frame is its resting state; `ceiling` ms bounds the wait if it never settles.
 */
const sample = (page: Page, selector: string, ceiling = 15_000) =>
  page.evaluate(
    ([sel, limit]) =>
      new Promise<{ opacity: number; transform: string }[]>((resolve) => {
        const frames: { opacity: number; transform: string }[] = [];
        let animated = false;
        const start = performance.now();
        const step = () => {
          const el = document.querySelector(sel);
          if (el !== null) {
            const style = getComputedStyle(el);
            frames.push({ opacity: Number(style.opacity), transform: style.transform });
            const running = el.getAnimations().length > 0;
            animated ||= running;
            if (animated && !running) return resolve(frames);
          }
          if (performance.now() - start > limit) return resolve(frames);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    [selector, ceiling] as const,
  );

test("the first screen does not animate in: nothing arrives on load, and a later new tab does", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await recordArrivals(page);
  await page.reload();
  await expect(page.locator(SIDEBAR)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab").first()).toBeVisible();
  await expect.poll(() => page.locator(":root").getAttribute("data-ready")).toBe("");
  // A load-time arrival starts when its region mounts, before it is visible; two frames let transitionstart dispatch.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
  );
  expect(await arrivals(page)).toEqual([]);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect.poll(() => arrivals(page)).toContain("div:opacity");
});

test("showing the sidebar fades it in without moving it", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await expect.poll(() => page.locator(":root").getAttribute("data-ready")).toBe("");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  const frames = sample(page, SIDEBAR);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  const seen = await frames;
  expect(Math.min(...seen.map((frame) => frame.opacity))).toBeLessThan(0.5);
  expect(seen.at(-1)?.opacity).toBe(1);
  expect(seen.every((frame) => frame.transform === "none")).toBe(true);
});

test("a new tab scales and fades in, and settles at rest", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await expect.poll(() => page.locator(":root").getAttribute("data-ready")).toBe("");
  const count = await page.getByRole("tab").count();
  const newest = `[role="tablist"] > div:nth-of-type(${count + 1})`;
  const frames = sample(page, newest);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const seen = await frames;
  expect(seen.length).toBeGreaterThan(0);
  expect(Math.min(...seen.map((frame) => frame.opacity))).toBeLessThan(0.5);
  expect(seen.some((frame) => frame.transform !== "none")).toBe(true);
  expect(seen.at(-1)).toEqual({ opacity: 1, transform: "none" });
});

test("under reduced motion a new tab only fades: no frame is transformed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await openNewTerminal(page);
  await expect.poll(() => page.locator(":root").getAttribute("data-ready")).toBe("");
  const count = await page.getByRole("tab").count();
  const frames = sample(page, `[role="tablist"] > div:nth-of-type(${count + 1})`);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const seen = await frames;
  expect(Math.min(...seen.map((frame) => frame.opacity))).toBeLessThan(0.5);
  expect(seen.every((frame) => frame.transform === "none")).toBe(true);
});
