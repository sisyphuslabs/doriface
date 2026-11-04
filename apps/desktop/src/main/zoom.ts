import type { BrowserWindow } from "electron";
import { nextZoomFactor, savedZoomFactor } from "../config/zoom.ts";
import type { ZoomStep } from "../shared/bridge.ts";
import { readSaved, writeSaved } from "./window-state.ts";

/** The window's zoom, saved in `file` so the next launch opens at it. */
export interface WindowZoom {
  readonly factor: number;
  applyOnEveryLoad(window: BrowserWindow): void;
  step(window: BrowserWindow, step: ZoomStep): void;
}

export function windowZoom(file: string): WindowZoom {
  let factor = savedZoomFactor(readSaved(file));
  return {
    get factor() {
      return factor;
    },
    applyOnEveryLoad(window) {
      const contents = window.webContents;
      contents.on("did-finish-load", () => contents.setZoomFactor(factor));
    },
    step(window, step) {
      factor = nextZoomFactor(factor, step);
      window.webContents.setZoomFactor(factor);
      writeSaved(file, { factor });
    },
  };
}
