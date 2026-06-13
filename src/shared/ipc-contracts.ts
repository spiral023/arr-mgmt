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

export type InstanceKind = "sonarr" | "radarr";

export type InstanceConfigInput = {
  kind: InstanceKind;
  name: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
};

export type InstanceConfigView = {
  kind: InstanceKind;
  name: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
};

export type InstanceTestResult = {
  ok: boolean;
  message: string;
  version?: string;
};

export type SonarrSeriesTableRow = {
  id: string;
  arrId: number;
  title: string;
  monitored: boolean;
  episodes: number;
  files: number;
  totalSizeBytes: number;
  funFiles: number;
  funShare: number;
  nonFunFiles: number;
  hasFiles: boolean;
  lastAnalyzed: string;
  lastSearched: string;
  lastGrabbed: string;
  status: "ready" | "searchable" | "cooldown" | "failed";
};

export type RendererApi = {
  invoke: <T = unknown>(channel: IpcChannel, payload?: unknown) => Promise<T>;
  onJobEvent: (callback: (payload: unknown) => void) => () => void;
};

declare global {
  interface Window {
    arrOps: RendererApi;
  }
}
