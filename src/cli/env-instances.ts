import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { InstanceStore } from "../main/instances/instance-store";
import type { SecretStore } from "../main/secrets/secret-store";
import type { InstanceConfigInput, InstanceConfigView, InstanceKind } from "../shared/ipc-contracts";

export type CliInstanceSource = "gui" | "env";
export type CliInstanceConfigView = InstanceConfigView & { source: CliInstanceSource };
export type CliInstanceOverrides = Partial<Record<InstanceKind, InstanceConfigInput>>;

type EnvLoadOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  isPackaged: boolean;
};

type CliInstanceStoreOptions = {
  overrides?: CliInstanceOverrides;
};

const instanceKinds = ["sonarr", "radarr"] as const;

export function loadDevEnvInstanceOverrides(options: EnvLoadOptions): CliInstanceOverrides {
  if (options.isPackaged) return {};

  const cwd = options.cwd ?? process.cwd();
  const env = { ...readDotEnv(cwd), ...(options.env ?? process.env) };

  return Object.fromEntries(
    instanceKinds.flatMap((kind) => {
      const prefix = kind.toUpperCase();
      const baseUrl = env[`${prefix}_URL`]?.trim().replace(/\/+$/, "");
      const apiKey = env[`${prefix}_API_KEY`]?.trim();
      if (!baseUrl || !apiKey) return [];
      const name = kind === "sonarr" ? "Sonarr" : "Radarr";
      return [[kind, { kind, name, baseUrl, apiKey, enabled: true } satisfies InstanceConfigInput]];
    }),
  ) as CliInstanceOverrides;
}

export class CliInstanceStore extends InstanceStore {
  private readonly overrides: CliInstanceOverrides;

  constructor(filePath: string, secrets: SecretStore, options: CliInstanceStoreOptions = {}) {
    super(filePath, secrets);
    this.overrides = options.overrides ?? {};
  }

  override list(): CliInstanceConfigView[] {
    return super.list().map((instance) => {
      const override = this.overrides[instance.kind];
      if (!override) return { ...instance, source: "gui" };
      return {
        kind: instance.kind,
        name: override.name.trim() || instance.name,
        baseUrl: override.baseUrl.trim().replace(/\/+$/, ""),
        enabled: override.enabled ?? instance.enabled,
        hasApiKey: Boolean(override.apiKey?.trim()),
        source: "env",
      };
    });
  }

  override getWithApiKey(kind: InstanceKind, explicitOverride?: InstanceConfigInput): { name: string; baseUrl: string; apiKey: string } {
    return super.getWithApiKey(kind, explicitOverride ?? this.overrides[kind]);
  }
}

function readDotEnv(cwd: string): Record<string, string> {
  const envPath = join(cwd, ".env");
  if (!existsSync(envPath)) return {};

  const entries: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = unquote(trimmed.slice(separator + 1).trim());
    if (key) entries[key] = value;
  }
  return entries;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
