import type {
  InstanceConfigInput,
  InstanceConfigView,
  InstanceTestResult,
  IpcChannel,
  SonarrSeriesTableRow,
} from "../../shared/ipc-contracts";

export async function invokeIpc<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.arrOps) {
    return getBrowserFallback<T>(channel);
  }
  return window.arrOps.invoke<T>(channel, payload);
}

export function listInstances(): Promise<InstanceConfigView[]> {
  return invokeIpc<InstanceConfigView[]>("instances:list");
}

export function saveInstance(input: InstanceConfigInput): Promise<InstanceConfigView> {
  return invokeIpc<InstanceConfigView>("instances:save", input);
}

export function testInstance(input: InstanceConfigInput): Promise<InstanceTestResult> {
  return invokeIpc<InstanceTestResult>("instances:test", input);
}

export function analyzeSonarr(): Promise<unknown> {
  return invokeIpc("jobs:enqueue", { name: "Analyze Sonarr", target: "sonarr" });
}

export function getSonarrRows(): Promise<SonarrSeriesTableRow[]> {
  return invokeIpc<SonarrSeriesTableRow[]>("library:sonarr");
}

function getBrowserFallback<T>(channel: IpcChannel): T {
  if (channel === "instances:list") {
    return [
      { kind: "sonarr", name: "Sonarr", baseUrl: "http://192.168.0.170:8989", enabled: true, hasApiKey: false },
      { kind: "radarr", name: "Radarr", baseUrl: "http://192.168.0.170:7878", enabled: true, hasApiKey: false },
    ] as T;
  }
  if (channel === "instances:test") {
    return { ok: false, message: "IPC is only available in the Electron app." } as T;
  }
  if (channel === "library:sonarr") {
    return [] as T;
  }
  return {} as T;
}
