// The overflow detector on hand-made pages: each page holds one layout, and the detector reports exactly the rules
// listed for it. These are the shapes the app's screens may grow into, so the layout spec can only pass if it sees them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { findOverflows } from "./overflow.ts";

/**
 * The app's own mono font, Vietnamese letters, with an ascent and descent as short as a system UI font's. Stacked marks
 * are placed by the shaper on every platform, so their ink stands 1.02 em above the baseline on macOS and Linux alike.
 */
const MONO = createRequire(join(import.meta.dirname, "../../../packages/ui/package.json")).resolve(
  "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2",
);
const MONO_FACE = `<style>@font-face { font-family: "Fixture Mono"; src: url(data:font/woff2;base64,${readFileSync(MONO).toString("base64")}) format("woff2"); ascent-override: 82%; descent-override: 30%; line-gap-override: 0%; }</style>`;

const LONG = "remote-build-machine-number-0001-workspace";
const BLOCK_ELLIPSIS = "display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
const SPACES = " ".repeat(40);

const PAGES: readonly { readonly name: string; readonly html: string; readonly found: readonly string[] }[] = [
  {
    name: "text clipped by its box",
    html: `<div style="width:100px;overflow:hidden;white-space:nowrap">${LONG}</div>`,
    found: ["clipped"],
  },
  {
    name: "an inline span clipped by its box",
    html: `<div style="width:100px;overflow:hidden;white-space:nowrap">at <span>${LONG}</span></div>`,
    found: ["clipped"],
  },
  {
    name: "inline code running out of a sentence",
    html: `<p style="width:100px;white-space:nowrap">Saved to <code>${LONG}</code></p>`,
    found: ["spill"],
  },
  {
    name: "a link cut off by a fixed-height card",
    html: `<div style="width:160px;height:20px;overflow:hidden"><a href="#">${LONG} ${LONG}</a></div>`,
    found: ["clipped"],
  },
  {
    name: "inline text that wraps inside its box, its spaces hanging past the edge",
    html:
      `<p style="width:120px">One <span>two three </span><a href="#">four five six </a><code>seven </code> eight</p>` +
      `<p style="width:100px;white-space:pre-wrap"><span>ab${SPACES}cd</span></p>`,
    found: [],
  },
  {
    name: "an ellipsis inside a control titled for something else",
    html: `<button title="Close" style="display:block;width:100px"><span style="${BLOCK_ELLIPSIS}">${LONG}</span></button>`,
    found: ["untitled"],
  },
  {
    name: "an ellipsis with an empty title",
    html: `<div style="width:100px"><span title="" style="${BLOCK_ELLIPSIS}">${LONG}</span></div>`,
    found: ["untitled"],
  },
  {
    name: "an ellipsis titled with its own text",
    html: `<div style="width:100px"><span title="${LONG}" style="${BLOCK_ELLIPSIS}">${LONG}</span></div>`,
    found: [],
  },
  {
    name: "an ellipsis whose control is titled with its text",
    html: `<button title="${LONG}" style="display:block;width:100px"><span style="${BLOCK_ELLIPSIS}">${LONG}</span></button>`,
    found: [],
  },
  {
    name: "a box one line tall that cuts the accents off capitals",
    html: `<div style="font-size:24px;line-height:1;overflow:hidden">ÅÉÎÕÛ</div>`,
    found: ["clipped"],
  },
  {
    name: "a box one line tall around capitals with no accents",
    html: `<div style="font-size:24px;line-height:1;overflow:hidden">AEIOU!</div>`,
    found: [],
  },
  {
    // \u1EAA's circumflex and tilde stand 1.02 em above a baseline the 1.25 line puts 0.885 em below its top: 3-4 px of
    // ink are cut off at 24 px. A widened em box cannot see it, since 1.28 em fits a 1.25 line within the slack.
    name: "a tightly led box that cuts the top off stacked marks",
    html: `${MONO_FACE}<div style="font:24px/1.25 'Fixture Mono';overflow:hidden">\u1EAA\u1EAA\u1EAA</div>`,
    found: ["clipped"],
  },
  {
    name: "accented capitals and descenders in a tightly led box",
    html: `<div style="font-size:24px;line-height:1.25;overflow:hidden">ÅÉÎÕÛ gjpqy</div>`,
    found: [],
  },
  {
    // A skip link before it is focused: visually hidden on purpose, so a screen reader still reads it.
    name: "visually hidden text (sr-only, clip-path)",
    html: `<a href="#x" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border-width:0">Skip to terminal</a>`,
    found: [],
  },
  {
    name: "visually hidden text (the older clip form)",
    html: `<a href="#x" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">Skip to sidebar</a>`,
    found: [],
  },
  {
    name: "a 1 px wide box that clips text without hiding it",
    html: `<div style="width:1px;overflow:hidden;white-space:nowrap">${LONG}</div>`,
    found: ["clipped"],
  },
];

for (const { name, html, found } of PAGES) {
  test(`overflow on ${name}: ${found.length === 0 ? "none" : found.join(", ")}`, async ({ page }) => {
    await page.setContent(`<body style="margin:8px;font:16px/1.25 system-ui">${html}</body>`);
    // A face loads only once a laid-out box asks for it, which can be after fonts.ready settles: load each one now.
    const faces = await page.evaluate(() =>
      Promise.all([...document.fonts].map(async (face) => (await face.load()).status)),
    );
    expect(faces.filter((status) => status !== "loaded")).toEqual([]);
    const rules = (await page.evaluate(findOverflows, [])).map((overflow) => overflow.rule);
    expect(rules).toEqual(found);
  });
}
