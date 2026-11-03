import { app, BrowserWindow, Menu, nativeTheme, screen, session, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { contextMenuTemplate } from "../config/context-menu.ts";
import { contentSecurityPolicy } from "../config/csp.ts";
import { APP_ORIGIN, loopbackDevUrl } from "../config/origin.ts";
import { restorePlacement } from "../config/window-state.ts";
import { launchBackground, secureWebPreferences, windowOptions } from "../config/window.ts";
import { Channel, parsePlatform } from "../shared/bridge.ts";
import { applyDevCsp, hardenContents, lockPermissions } from "./harden.ts";
import { findHc, hostCommand, type HostContext } from "./host-command.ts";
import { registerIpc } from "./ipc.ts";
import { LocalHost } from "./local-host.ts";
import { menuTemplate } from "./menu.ts";
import { registerAppScheme, serveApp } from "./protocol.ts";
import { applyMacTitlebar } from "./titlebar.ts";
import { readSaved, rememberPlacement, savedPlacement, writeSaved } from "./window-state.ts";

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
const savedFile = (name: string): string => join(app.getPath("userData"), name);

const liveWindow = (): BrowserWindow | undefined =>
  mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined;

/** The app has one window: brings it back when it exists and creates it, at `path`, only when it does not. */
function showWindow(path = "/"): BrowserWindow {
  const window = liveWindow();
  if (window === undefined) return createWindow(path);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

/** Shows an app path in the one window: an in-app navigation once its page has loaded, the first page otherwise. */
function navigate(path: string): void {
  const existing = liveWindow();
  if (existing === undefined) return void showWindow(path);
  showWindow();
  const contents = existing.webContents;
  if (contents.isLoading()) contents.once("did-finish-load", () => contents.send(Channel.navigate, path));
  else contents.send(Channel.navigate, path);
}

const openSettings = (): void => navigate("/settings");

function createWindow(path: string): BrowserWindow {
  const placementFile = savedFile("window-placement.json");
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const placement = restorePlacement(savedPlacement(placementFile), workAreas, screen.getPrimaryDisplay().workArea);
  const background = launchBackground(readSaved(savedFile("window-background.json")), nativeTheme.shouldUseDarkColors);
  const window = new BrowserWindow(windowOptions(platform, webPreferences, { background, placement }));
  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  if (platform === "darwin") applyMacTitlebar(window);
  rememberPlacement(window, placementFile);
  window.webContents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(params);
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window });
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  window.loadURL(new URL(path, devUrl ?? `${APP_ORIGIN}/`).href).catch((error: unknown) => {
    console.error(`failed to load the app: ${String(error)}`);
  });
  return window;
}

function setWindowBackground(color: string): void {
  liveWindow()?.setBackgroundColor(color);
  writeSaved(savedFile("window-background.json"), { background: color });
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({ platform, openExternal, openSettings })));
  registerIpc({
    origin,
    startLocalHost: () => localHost.start(),
    openExternal: (url) => shell.openExternal(url),
    setWindowBackground,
    closeWindow: () => liveWindow()?.close(),
  });
  showWindow();
  app.on("activate", () => void showWindow());
}

registerAppScheme();
app.enableSandbox();
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("web-contents-created", (_event, contents) => hardenContents(contents, origin, navigate));
  app.on("second-instance", () => {
    if (app.isReady()) showWindow();
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
