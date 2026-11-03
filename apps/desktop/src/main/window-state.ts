import type { BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { parsePlacement, type Area } from "../config/window-state.ts";

export type Log = (line: string) => void;

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";

/** A JSON file the shell saved earlier: undefined when it does not exist yet; anything else unreadable is reported. */
export function readSaved(file: string, log: Log = console.error): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (!isMissing(error)) log(`could not read ${file}: ${String(error)}`);
    return undefined;
  }
}

export function writeSaved(file: string, value: unknown, log: Log = console.error): void {
  try {
    writeFileSync(file, JSON.stringify(value));
  } catch (error) {
    log(`could not save ${file}: ${String(error)}`);
  }
}

/** The last normal (not maximised, not full screen) bounds saved in `file`, or undefined on first launch. */
export function savedPlacement(file: string, log: Log = console.error): Area | undefined {
  return parsePlacement(readSaved(file, log));
}

/** Saves the window's normal bounds when it closes, so the next launch reopens it there. */
export function rememberPlacement(window: BrowserWindow, file: string): void {
  window.on("close", () => writeSaved(file, window.getNormalBounds()));
}
