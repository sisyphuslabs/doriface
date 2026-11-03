import { contextBridge, ipcRenderer } from "electron";
import { Channel, isLocalHostEndpoint, parsePlatform, VERSION_ARG, type DorifaceBridge } from "../shared/bridge.ts";

const version = process.argv.find((arg) => arg.startsWith(VERSION_ARG))?.slice(VERSION_ARG.length) ?? "0.0.0";

const bridge: DorifaceBridge = {
  version,
  platform: parsePlatform(process.platform),
  async openExternal(url) {
    const opened: unknown = await ipcRenderer.invoke(Channel.openExternal, url);
    return opened === true;
  },
  async startLocalHost() {
    const endpoint: unknown = await ipcRenderer.invoke(Channel.startLocalHost);
    if (!isLocalHostEndpoint(endpoint)) throw new Error("the main process returned no local host endpoint");
    return { url: endpoint.url, token: endpoint.token };
  },
  onNavigate(listener) {
    ipcRenderer.on(Channel.navigate, (_event, path: unknown) => {
      if (typeof path === "string") listener(path);
    });
  },
  async setWindowBackground(color) {
    const painted: unknown = await ipcRenderer.invoke(Channel.setWindowBackground, color);
    return painted === true;
  },
  async closeWindow() {
    await ipcRenderer.invoke(Channel.closeWindow);
  },
};

contextBridge.exposeInMainWorld("doriface", bridge);
