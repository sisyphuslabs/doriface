import type { MenuItemConstructorOptions } from "electron";
import type { DesktopPlatform } from "../shared/bridge.ts";

export const REPOSITORY_URL = "https://github.com/sisyphuslabs/doriface";

export interface MenuOptions {
  readonly platform: DesktopPlatform;
  readonly openExternal: (url: string) => void;
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
  return options.platform === "darwin" ? [{ role: "appMenu" }, ...common] : common;
}
