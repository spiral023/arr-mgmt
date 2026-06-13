export type IpcChannel =
  | "settings:get"
  | "settings:update"
  | "instances:list"
  | "instances:save"
  | "instances:test"
  | "library:summary"
  | "library:sonarr"
  | "library:radarr"
  | "jobs:list"
  | "jobs:enqueue"
  | "quota:summary";

export type RendererApi = {
  invoke: <T = unknown>(channel: IpcChannel, payload?: unknown) => Promise<T>;
  onJobEvent: (callback: (payload: unknown) => void) => () => void;
};

declare global {
  interface Window {
    arrOps: RendererApi;
  }
}
