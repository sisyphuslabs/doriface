import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

const SIDEBAR = 'aside[aria-label="Workspace"]';

/** Transitions running on arrival regions now: each element's selector role and the properties it animates. */
const arrivals = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .flatMap((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (!(target instanceof Element) || !target.classList.contains("motion-arrive")) return [];
        if (!(animation instanceof CSSTransition)) return [];
        return [`${target.tagName.toLowerCase()}:${animation.transitionProperty}`];
      })
      .sort(),
  );

/** Watches an element's opacity and transform from now on, every frame, for the given time. */
const sample = (page: Page, selector: string, ms: number) =>
  page.evaluate(
    ([sel, duration]) =>
      new Promise<{ opacity: number; transform: string }[]>((resolve) => {
        const frames: { opacity: number; transform: string }[] = [];
        const start = performance.now();
        const step = () => {
          const el = document.querySelector(sel);
          if (el !== null) {
            const style = getComputedStyle(el);
            frames.push({ opacity: Number(style.opacity), transform: style.transform });
          }
          if (performance.now() - start < duration) requestAnimationFrame(step);
          else resolve(frames);
        };
        requestAnimationFrame(step);
      }),
    [selector, ms] as const,
  );

test("the first screen does not animate in: nothing arrives on load", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await page.reload();
  await expect(page.locator(SIDEBAR)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab").first()).toBeVisible();
  await expect.poll(() => page.locator(":root").getAttribute("data-ready")).toBe("");
  expect(await arrivals(page)).toEqual([]);
});

test("showing the sidebar fades it in without moving it", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await expect.poll(() => page.locator(":root").getAttribute("data-ready")).toBe("");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  const frames = sample(page, SIDEBAR, 400);
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
  const frames = sample(page, newest, 400);
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
  const frames = sample(page, `[role="tablist"] > div:nth-of-type(${count + 1})`, 400);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const seen = await frames;
  expect(Math.min(...seen.map((frame) => frame.opacity))).toBeLessThan(0.5);
  expect(seen.every((frame) => frame.transform === "none")).toBe(true);
});
