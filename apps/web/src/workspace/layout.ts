/** Workspace layout choices that outlive a reload, kept beside the other local settings (doriface.appearance). */
export interface Layout {
  readonly sidebar: boolean;
  /** The sidebar's width in CSS px when it is not a rail; dragging back from the rail returns to it. */
  readonly sidebarWidth: number;
  /** The sidebar is dragged narrow, to the icon rail. */
  readonly rail: boolean;
  /** The share of the sidebar's list height the Agents section (docked at the bottom) takes, 0..1. */
  readonly agentsShare: number;
}

export const LAYOUT_KEY = "doriface.layout";
/** --sidebar-width's default, 16.75rem. */
export const DEFAULT_SIDEBAR_WIDTH = 268;
/** Agents' default share of the sidebar's list height, about herdr-app's split. */
export const DEFAULT_AGENTS_SHARE = 0.4;
/** The least height, in CSS px, either section keeps however the divider is dragged. */
export const MIN_SECTION_HEIGHT = 96;
/** The divider between them, which the list height includes. */
const DIVIDER = 1;
const DEFAULT: Layout = {
  sidebar: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  rail: false,
  agentsShare: DEFAULT_AGENTS_SHARE,
};

/** Below this a drag turns the sidebar into the rail (herdr-app's threshold). */
export const RAIL_BELOW = 160;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

const clampWidth = (px: number): number => Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, px)));

/** Where a drag of the sidebar's edge to `px` leaves it: the rail below the threshold, else that width, clamped. */
export function dragTo(px: number): Pick<Layout, "sidebarWidth" | "rail"> | Pick<Layout, "rail"> {
  return px < RAIL_BELOW ? { rail: true } : { rail: false, sidebarWidth: clampWidth(px) };
}

/** The Agents share bounds within `total` px of list height: each section keeps its minimum, or both halve a short one. */
export function shareBounds(total: number): { readonly min: number; readonly max: number } {
  if (total < MIN_SECTION_HEIGHT * 2 + DIVIDER) return { min: 0.5, max: 0.5 };
  return { min: MIN_SECTION_HEIGHT / total, max: 1 - (MIN_SECTION_HEIGHT + DIVIDER) / total };
}

/** `share` held inside the bounds `total` px of list height allows. */
export function clampShare(share: number, total: number): number {
  const { min, max } = shareBounds(total);
  return Math.min(max, Math.max(min, share));
}

const isShare = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;

export function loadLayout(storage: Pick<Storage, "getItem"> = localStorage): Layout {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(LAYOUT_KEY) ?? "null");
  } catch {
    return DEFAULT;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT;
  const sidebar: unknown = Reflect.get(parsed, "sidebar");
  const width: unknown = Reflect.get(parsed, "sidebarWidth");
  const rail: unknown = Reflect.get(parsed, "rail");
  const share: unknown = Reflect.get(parsed, "agentsShare");
  return {
    sidebar: typeof sidebar === "boolean" ? sidebar : DEFAULT.sidebar,
    sidebarWidth: typeof width === "number" && Number.isFinite(width) ? clampWidth(width) : DEFAULT.sidebarWidth,
    rail: typeof rail === "boolean" ? rail : DEFAULT.rail,
    agentsShare: isShare(share) ? share : DEFAULT.agentsShare,
  };
}
