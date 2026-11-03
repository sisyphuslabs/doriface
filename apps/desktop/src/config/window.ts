import type { BrowserWindowConstructorOptions, WebPreferences } from "electron";
import { VERSION_ARG, type DesktopPlatform } from "../shared/bridge.ts";

/** herdr-app's traffic-light inset under a hidden-inset titlebar. */
export const TRAFFIC_LIGHT_POSITION = { x: 12, y: 16 } as const;

export function secureWebPreferences(preload: string, version: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    spellcheck: false,
    additionalArguments: [`${VERSION_ARG}${version}`],
  };
}

export function windowOptions(
  platform: DesktopPlatform,
  webPreferences: WebPreferences,
): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    title: "doriface",
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#0b0b0c",
    webPreferences,
  };
  if (platform !== "darwin") return base;
  return { ...base, titleBarStyle: "hiddenInset", trafficLightPosition: { ...TRAFFIC_LIGHT_POSITION } };
}
