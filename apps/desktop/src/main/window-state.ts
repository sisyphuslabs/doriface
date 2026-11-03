import type { BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { parsePlacement, type Area } from "../config/window-state.ts";

/** The last normal (not maximised, not full screen) bounds saved in `file`, or undefined on first launch. */
export function savedPlacement(file: string): Area | undefined {
  try {
    return parsePlacement(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // No file yet, or one this build cannot read: the window opens at the default size.
    return undefined;
  }
}

/** Saves the window's normal bounds when it closes, so the next launch reopens it there. */
export function rememberPlacement(window: BrowserWindow, file: string): void {
  window.on("close", () => {
    try {
      writeFileSync(file, JSON.stringify(window.getNormalBounds()));
    } catch (error) {
      console.error(`could not save the window position: ${String(error)}`);
    }
  });
}
