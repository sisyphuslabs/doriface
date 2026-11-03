import { app, BrowserWindow, Menu, session, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { contentSecurityPolicy } from "../config/csp.ts";
import { APP_ORIGIN, loopbackDevUrl } from "../config/origin.ts";
import { secureWebPreferences, windowOptions } from "../config/window.ts";
import { parsePlatform } from "../shared/bridge.ts";
import { applyDevCsp, hardenContents, lockPermissions } from "./harden.ts";
import { findHc, hostCommand, type HostContext } from "./host-command.ts";
import { registerIpc } from "./ipc.ts";
import { LocalHost } from "./local-host.ts";
import { menuTemplate } from "./menu.ts";
import { registerAppScheme, serveApp } from "./protocol.ts";

const platform = parsePlatform(process.platform);
const devSetting = app.isPackaged ? undefined : process.env["DORIFACE_DESKTOP_DEV_URL"];
const devUrl = devSetting === undefined || devSetting === "" ? undefined : loopbackDevUrl(devSetting);
const origin = devUrl === undefined ? APP_ORIGIN : new URL(devUrl).origin;
const csp = contentSecurityPolicy({ devServer: devUrl });
const webPreferences = secureWebPreferences(join(import.meta.dirname, "preload.cjs"), app.getVersion());

/** The built web app: bundled as a resource, or overridden in a checkout. */
const webRoot = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "web")
    : (process.env["DORIFACE_WEB_DIST"] ?? join(app.getAppPath(), "..", "web", "dist"));

const hostContext = (): HostContext => ({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  platform,
  home: homedir(),
  env: process.env,
});

const openExternal = (url: string): void => {
  shell.openExternal(url).catch((error: unknown) => console.error(`openExternal failed: ${String(error)}`));
};

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  const window = new BrowserWindow(windowOptions(platform, webPreferences));
  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  window.loadURL(devUrl ?? `${APP_ORIGIN}/`).catch((error: unknown) => {
    console.error(`failed to load the app: ${String(error)}`);
  });
}

function ready(): void {
  const context = hostContext();
  const localHost = new LocalHost({
    command: hostCommand(context),
    hc: findHc(context),
    env: process.env,
    log: (line) => console.log(line),
  });
  app.on("will-quit", () => void localHost.stop());
  lockPermissions(session.defaultSession, origin);
  if (devUrl === undefined) serveApp(webRoot(), csp);
  else applyDevCsp(session.defaultSession, origin, csp);
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({ platform, openExternal })));
  registerIpc({ origin, startLocalHost: () => localHost.start(), openExternal: (url) => shell.openExternal(url) });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

registerAppScheme();
app.enableSandbox();
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("web-contents-created", (_event, contents) => hardenContents(contents, origin, webPreferences));
  app.on("second-instance", () => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => {
    if (platform !== "darwin") app.quit();
  });
  app
    .whenReady()
    .then(ready)
    .catch((error: unknown) => {
      console.error(`doriface failed to start: ${String(error)}`);
      app.exit(1);
    });
}
