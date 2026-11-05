/** Workspace layout choices that outlive a reload, kept beside the other local settings (doriface.appearance). */
export interface Layout {
  readonly sidebar: boolean;
  /** The sidebar's width in CSS px when it is not a rail; dragging back from the rail returns to it. */
  readonly sidebarWidth: number;
  /** The sidebar is dragged narrow, to the icon rail. */
  readonly rail: boolean;
}

export const LAYOUT_KEY = "doriface.layout";
/** --sidebar-width's default, 16.75rem. */
export const DEFAULT_SIDEBAR_WIDTH = 268;
const DEFAULT: Layout = { sidebar: true, sidebarWidth: DEFAULT_SIDEBAR_WIDTH, rail: false };

/** Below this a drag turns the sidebar into the rail (herdr-app's threshold). */
export const RAIL_BELOW = 160;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

const clampWidth = (px: number): number => Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, px)));

/** Where a drag of the sidebar's edge to `px` leaves it: the rail below the threshold, else that width, clamped. */
export function dragTo(px: number): Pick<Layout, "sidebarWidth" | "rail"> | Pick<Layout, "rail"> {
  return px < RAIL_BELOW ? { rail: true } : { rail: false, sidebarWidth: clampWidth(px) };
}

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
  return {
    sidebar: typeof sidebar === "boolean" ? sidebar : DEFAULT.sidebar,
    sidebarWidth: typeof width === "number" && Number.isFinite(width) ? clampWidth(width) : DEFAULT.sidebarWidth,
    rail: typeof rail === "boolean" ? rail : DEFAULT.rail,
  };
}
