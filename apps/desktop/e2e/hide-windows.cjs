// Loaded with Electron's -r flag by e2e/launch.ts, so an e2e run on a developer's Mac never puts a window on screen.
// Every window is made fully transparent the moment it exists and every way of showing or focusing one is a no-op; the
// page still renders, so screenshots and DOM checks work. Packaged CI runs under xvfb and does not load it.
if (process.versions.electron !== undefined && process.type === "browser") {
  const { app, BaseWindow, BrowserWindow } = require("electron");
  const { appendFileSync } = require("node:fs");
  const marker = process.env.DORIFACE_E2E_HIDE_MARKER;
  const note = (line) => {
    if (marker) appendFileSync(marker, `pid=${process.pid} ${line}\n`);
  };
  const silenced = ["show", "showInactive", "focus", "moveTop"];
  for (const Window of [BaseWindow, BrowserWindow]) {
    for (const name of silenced) Window.prototype[name] = function () {};
  }
  app.on("browser-window-created", (_event, window) => {
    window.setOpacity(0);
    window.setSkipTaskbar(true);
    window.hide();
    note(`window ${window.id} created hidden`);
  });
  app.whenReady().then(() => {
    app.dock?.hide();
    note("hooked");
    return undefined;
  });
}
