import { LIVE, unsupported, type KeyDef } from "./schema.ts";

const TEXT = { type: "text" } as const;
const METRIC = { type: "metric" } as const;
const BOOL = { type: "bool" } as const;

export const FONT_KEYS: readonly KeyDef[] = [
  {
    key: "font-family",
    group: "font",
    kind: TEXT,
    repeatable: true,
    defaults: [],
    description: "Font families in order; repeat for fallbacks. An empty value clears the list.",
    support: LIVE,
  },
  ...(["bold", "italic", "bold-italic"] as const).map((style): KeyDef => ({
    key: `font-family-${style}`,
    group: "font",
    kind: TEXT,
    repeatable: true,
    defaults: [],
    description: `Families for ${style.replace("-", " ")} text; unset uses font-family.`,
    support: LIVE,
  })),
  {
    key: "font-size",
    group: "font",
    kind: { type: "number", min: 4, max: 72, step: 0.5 },
    repeatable: false,
    defaults: ["13"],
    description: "Font size in points.",
    support: LIVE,
  },
  {
    key: "font-feature",
    group: "font",
    kind: { type: "feature" },
    repeatable: true,
    defaults: [],
    description: "OpenType features, e.g. -calt to turn programming ligatures off, or -calt, -liga, -dlig.",
    support: LIVE,
  },
  {
    key: "font-variation",
    group: "font",
    kind: { type: "variation" },
    repeatable: true,
    defaults: [],
    description: "Variable font axes as id=value, e.g. wght=500.",
    support: LIVE,
  },
  {
    key: "font-thicken",
    group: "font",
    kind: BOOL,
    repeatable: false,
    defaults: ["false"],
    description: "Draw glyphs with a thicker stroke (a hairline text stroke in the browser).",
    support: LIVE,
  },
  {
    key: "adjust-cell-height",
    group: "font",
    kind: METRIC,
    repeatable: false,
    defaults: [""],
    description: "Add pixels or a percentage to the cell height; text stays centered.",
    support: LIVE,
  },
  {
    key: "adjust-cell-width",
    group: "font",
    kind: METRIC,
    repeatable: false,
    defaults: [""],
    description: "Add pixels or a percentage to the cell width.",
    support: LIVE,
  },
  {
    key: "adjust-font-baseline",
    group: "font",
    kind: METRIC,
    repeatable: false,
    defaults: [""],
    description: "Move the text baseline up (positive) or down.",
    support: unsupported("The DOM renderer centers text by line height and has no baseline offset."),
  },
];
