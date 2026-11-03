import { DEFAULT_WINDOW_SIZE, MIN_WINDOW_SIZE, type WindowPlacement } from "./window.ts";

export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How much of the window's top edge must land on a display for its saved position to be kept. */
const GRIP = { width: 100, height: 40 } as const;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const bound = (size: number, min: number, max: number): number => Math.max(min, Math.min(size, max));

/** A saved placement read from disk, an untrusted boundary: anything not four finite numbers is no placement. */
export function parsePlacement(value: unknown): Area | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const [x, y, width, height] = ["x", "y", "width", "height"].map((key) => Reflect.get(value, key));
  if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) return undefined;
  return { x, y, width, height };
}

function overlap(a: Area, b: Area): Area {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * The window comes back on the display its top edge was on (a display may have been unplugged since), no larger than
 * that display's work area and moved back inside it; otherwise it opens centred at its saved size, no larger than the
 * main display's work area. No saved placement is the default size, centred.
 */
export function restorePlacement(saved: Area | undefined, workAreas: readonly Area[], main: Area): WindowPlacement {
  if (saved === undefined) return { ...DEFAULT_WINDOW_SIZE };
  const grip: Area = { x: saved.x, y: saved.y, width: Math.min(saved.width, GRIP.width), height: GRIP.height };
  const home = workAreas.find((area) => {
    const shared = overlap(grip, area);
    return shared.width >= grip.width && shared.height >= grip.height;
  });
  const area = home ?? main;
  const width = bound(saved.width, MIN_WINDOW_SIZE.width, area.width);
  const height = bound(saved.height, MIN_WINDOW_SIZE.height, area.height);
  if (home === undefined) return { width, height };
  const x = Math.max(home.x, Math.min(saved.x, home.x + home.width - width));
  const y = Math.max(home.y, Math.min(saved.y, home.y + home.height - height));
  return { x, y, width, height };
}
