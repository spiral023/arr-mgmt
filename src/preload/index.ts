import { contextBridge, ipcRenderer } from "electron";
import type { RendererApi } from "../shared/ipc-contracts";

const api: RendererApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onSchedulerEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { paused: boolean }) => callback(payload);
    ipcRenderer.on("scheduler:event", listener);
    return () => { ipcRenderer.off("scheduler:event", listener); };
  },
  onJobEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("jobs:event", listener);
    return () => ipcRenderer.off("jobs:event", listener);
  },
};

contextBridge.exposeInMainWorld("arrOps", api);
