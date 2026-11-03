import type { BrowserWindow } from "electron";
import { MAC_INSET_CSS, MAC_TITLEBAR_CSS } from "../config/window.ts";

const report = (what: string) => (error: unknown) => console.error(`could not ${what}: ${String(error)}`);

/**
 * Gives the page the hidden-inset titlebar: the drag rows on every load, and the window-button inset whenever the
 * buttons are on screen, which is everywhere but full screen.
 */
export function applyMacTitlebar(window: BrowserWindow): void {
  const contents = window.webContents;
  let inset: Promise<string> | undefined;
  const showInset = (): void => {
    if (inset !== undefined || window.isFullScreen()) return;
    inset = contents.insertCSS(MAC_INSET_CSS);
    inset.catch(report("add the titlebar inset"));
  };
  const hideInset = (): void => {
    const key = inset;
    inset = undefined;
    void key?.then((value) => contents.removeInsertedCSS(value)).catch(report("remove the titlebar inset"));
  };
  contents.on("dom-ready", () => {
    // A new document starts without the sheets the last one had.
    inset = undefined;
    contents.insertCSS(MAC_TITLEBAR_CSS).catch(report("add the titlebar drag rows"));
    showInset();
  });
  window.on("enter-full-screen", hideInset);
  window.on("leave-full-screen", showInset);
}
