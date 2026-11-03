// The overflow detector on hand-made pages: each page holds one layout, and the detector reports exactly the rules
// listed for it. These are the shapes the app's screens may grow into, so the layout spec can only pass if it sees them.
import { expect, test } from "@playwright/test";
import { findOverflows } from "./overflow.ts";

const LONG = "remote-build-machine-number-0001-workspace";
const BLOCK_ELLIPSIS = "display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

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
    name: "inline text that wraps inside its box",
    html: `<p style="width:120px">One <span>two three </span><a href="#">four five six </a><code>seven </code> eight</p>`,
    found: [],
  },
  {
    name: "an ellipsis inside a control titled for something else",
    html: `<button title="Close" style="display:block;width:100px"><span style="${BLOCK_ELLIPSIS}">${LONG}</span></button>`,
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
    name: "accented capitals and descenders in a tightly led box",
    html: `<div style="font-size:24px;line-height:1.25;overflow:hidden">ÅÉÎÕÛ gjpqy</div>`,
    found: [],
  },
];

for (const { name, html, found } of PAGES) {
  test(`overflow on ${name}: ${found.length === 0 ? "none" : found.join(", ")}`, async ({ page }) => {
    await page.setContent(`<body style="margin:8px;font:16px/1.25 system-ui">${html}</body>`);
    const rules = (await page.evaluate(findOverflows, [])).map((overflow) => overflow.rule);
    expect(rules).toEqual(found);
  });
}
