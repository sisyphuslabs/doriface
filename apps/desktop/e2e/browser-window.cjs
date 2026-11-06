// A second, fresh Chromium for the pairing spec: the doriface web app in its own profile, as another computer's
// browser would see it. Electron is already a dependency, so no extra browser download is needed. The URL to open is
// the first http(s) argument.
const { app, BrowserWindow } = require("electron");

const url = process.argv.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  return window.loadURL(url ?? "about:blank");
});

app.on("window-all-closed", () => app.quit());
