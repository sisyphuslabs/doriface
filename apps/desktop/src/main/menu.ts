import type { MenuItemConstructorOptions } from "electron";
import type { DesktopPlatform } from "../shared/bridge.ts";

export const REPOSITORY_URL = "https://github.com/sisyphuslabs/doriface";

export interface MenuOptions {
  readonly platform: DesktopPlatform;
  readonly openExternal: (url: string) => void;
  readonly openSettings: () => void;
}

/**
 * The macOS app menu in its standard order, with Settings… after About. The page's keymap owns Cmd+, (it also closes
 * Settings), so the item shows the shortcut without registering it and never runs twice for one key press.
 */
function appMenu(openSettings: () => void): MenuItemConstructorOptions {
  return {
    role: "appMenu",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Settings…", accelerator: "CommandOrControl+,", registerAccelerator: false, click: openSettings },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
}

/** Standard roles carry the platform's own labels and keyboard shortcuts. */
export function menuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
  const common: MenuItemConstructorOptions[] = [
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "doriface on GitHub", click: () => options.openExternal(REPOSITORY_URL) }],
    },
  ];
  return options.platform === "darwin" ? [appMenu(options.openSettings), ...common] : common;
}
