import { contextBridge, ipcRenderer } from "electron";
import type { RendererApi } from "../shared/ipc-contracts";

const api: RendererApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onJobEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("jobs:event", listener);
    return () => ipcRenderer.off("jobs:event", listener);
  },
};

contextBridge.exposeInMainWorld("arrOps", api);
