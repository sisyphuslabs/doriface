import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { allowedExternal } from "../config/external.ts";
import { isSameOrigin } from "../config/origin.ts";
import { Channel, type LocalHostEndpoint } from "../shared/bridge.ts";

export interface IpcDeps {
  readonly origin: string;
  readonly startLocalHost: () => Promise<LocalHostEndpoint>;
}

function assertAppFrame(event: IpcMainInvokeEvent, origin: string): void {
  const url = event.senderFrame?.url ?? "";
  if (!isSameOrigin(url, origin)) throw new Error(`refused IPC from ${url === "" ? "a detached frame" : url}`);
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(Channel.openExternal, async (event, candidate: unknown) => {
    assertAppFrame(event, deps.origin);
    const url = typeof candidate === "string" ? allowedExternal(candidate) : undefined;
    if (url === undefined) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle(Channel.startLocalHost, (event) => {
    assertAppFrame(event, deps.origin);
    return deps.startLocalHost();
  });
}
