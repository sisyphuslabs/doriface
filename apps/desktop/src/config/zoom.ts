import type { ZoomStep } from "../shared/bridge.ts";

/** Chromium's own page-zoom steps, within the range where the window stays usable. */
export const ZOOM_FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

const DEFAULT_FACTOR = 1;
const SMALLEST = ZOOM_FACTORS[0];
const LARGEST = ZOOM_FACTORS[ZOOM_FACTORS.length - 1] ?? DEFAULT_FACTOR;

/** The window zoom one step from `current`; the ends of the range stay where they are. */
export function nextZoomFactor(current: number, step: ZoomStep): number {
  switch (step) {
    case "reset":
      return DEFAULT_FACTOR;
    case "in":
      return ZOOM_FACTORS.find((factor) => factor > current + 0.001) ?? LARGEST;
    case "out":
      return ZOOM_FACTORS.findLast((factor) => factor < current - 0.001) ?? SMALLEST;
  }
}

/** The zoom saved as `{ factor }` at the last launch, as the nearest step; 100% when nothing usable was saved. */
export function savedZoomFactor(saved: unknown): number {
  const factor: unknown = typeof saved === "object" && saved !== null ? Reflect.get(saved, "factor") : undefined;
  if (typeof factor !== "number" || !Number.isFinite(factor)) return DEFAULT_FACTOR;
  return ZOOM_FACTORS.reduce((best, step) => (Math.abs(step - factor) < Math.abs(best - factor) ? step : best));
}
