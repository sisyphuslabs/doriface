import { ipcMain } from "electron";
import { Channel } from "../shared/bridge.ts";
import { ipcHandlers, type IpcDeps } from "./ipc-handlers.ts";

export function registerIpc(deps: IpcDeps): void {
  const handlers = ipcHandlers(deps);
  ipcMain.handle(Channel.openExternal, (event, candidate: unknown) => handlers.openExternal(event, candidate));
  ipcMain.handle(Channel.startLocalHost, (event) => handlers.startLocalHost(event));
}
