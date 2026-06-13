import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { InstanceConfigInput, InstanceConfigView, InstanceKind } from "../../shared/ipc-contracts";
import type { SecretStore } from "../secrets/secret-store";

type StoredInstance = {
  kind: InstanceKind;
  name: string;
  baseUrl: string;
  enabled: boolean;
  apiKeyEncrypted?: string;
};

type InstanceStoreFile = {
  instances: StoredInstance[];
};

const defaultInstances: StoredInstance[] = [
  { kind: "sonarr", name: "Sonarr", baseUrl: "http://192.168.0.170:8989", enabled: true },
  { kind: "radarr", name: "Radarr", baseUrl: "http://192.168.0.170:7878", enabled: true },
];

export class InstanceStore {
  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretStore,
  ) {}

  list(): InstanceConfigView[] {
    return this.read().instances.map((instance) => ({
      kind: instance.kind,
      name: instance.name,
      baseUrl: instance.baseUrl,
      enabled: instance.enabled,
      hasApiKey: Boolean(instance.apiKeyEncrypted),
    }));
  }

  save(input: InstanceConfigInput): InstanceConfigView {
    const file = this.read();
    const existing = file.instances.find((instance) => instance.kind === input.kind);
    const next: StoredInstance = {
      kind: input.kind,
      name: input.name.trim() || input.kind,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      enabled: input.enabled ?? true,
      apiKeyEncrypted: input.apiKey?.trim()
        ? this.secrets.encrypt(input.apiKey.trim())
        : existing?.apiKeyEncrypted,
    };

    file.instances = file.instances.filter((instance) => instance.kind !== input.kind);
    file.instances.push(next);
    this.write(file);
    return this.list().find((instance) => instance.kind === input.kind)!;
  }

  getWithApiKey(kind: InstanceKind, override?: InstanceConfigInput): { name: string; baseUrl: string; apiKey: string } {
    if (override?.apiKey?.trim()) {
      return {
        name: override.name.trim() || kind,
        baseUrl: override.baseUrl.trim().replace(/\/+$/, ""),
        apiKey: override.apiKey.trim(),
      };
    }

    const existing = this.read().instances.find((instance) => instance.kind === kind);
    if (!existing?.apiKeyEncrypted) {
      throw new Error(`${kind} API key is not saved yet`);
    }

    return {
      name: existing.name,
      baseUrl: existing.baseUrl,
      apiKey: this.secrets.decrypt(existing.apiKeyEncrypted),
    };
  }

  private read(): InstanceStoreFile {
    if (!existsSync(this.filePath)) {
      return { instances: [...defaultInstances] };
    }
    return JSON.parse(readFileSync(this.filePath, "utf8")) as InstanceStoreFile;
  }

  private write(file: InstanceStoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2));
  }
}
