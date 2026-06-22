import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CliInstanceStore, loadDevEnvInstanceOverrides } from "./env-instances";
import type { SecretStore } from "../main/secrets/secret-store";

const passthroughSecrets: SecretStore = {
  encrypt: (value) => `enc:${value}`,
  decrypt: (value) => value.replace(/^enc:/, ""),
};

function makeTempDir(): string {
  return join(tmpdir(), `arr-ops-cli-env-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe("loadDevEnvInstanceOverrides", () => {
  it("loads complete Sonarr and Radarr overrides from .env when not packaged", () => {
    const cwd = makeTempDir();
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, ".env"),
      [
        "SONARR_URL=http://sonarr.local:8989/",
        "SONARR_API_KEY=sonarr-key",
        "RADARR_URL=http://radarr.local:7878",
        "RADARR_API_KEY=radarr-key",
      ].join("\n"),
    );

    const overrides = loadDevEnvInstanceOverrides({ cwd, env: {}, isPackaged: false });

    expect(overrides.sonarr).toMatchObject({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKey: "sonarr-key",
    });
    expect(overrides.radarr).toMatchObject({
      kind: "radarr",
      name: "Radarr",
      baseUrl: "http://radarr.local:7878",
      apiKey: "radarr-key",
    });
  });

  it("ignores .env overrides when the app is packaged", () => {
    const cwd = makeTempDir();
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, ".env"), "SONARR_URL=http://sonarr.local:8989\nSONARR_API_KEY=sonarr-key\n");

    expect(loadDevEnvInstanceOverrides({ cwd, env: {}, isPackaged: true })).toEqual({});
  });
});

describe("CliInstanceStore", () => {
  it("uses env overrides for API-key lookups and marks list rows with source", () => {
    const cwd = makeTempDir();
    mkdirSync(cwd, { recursive: true });
    const store = new CliInstanceStore(join(cwd, "instances.json"), passthroughSecrets, {
      overrides: {
        sonarr: {
          kind: "sonarr",
          name: "Sonarr",
          baseUrl: "http://sonarr.env:8989",
          apiKey: "env-key",
          enabled: true,
        },
      },
    });

    expect(store.getWithApiKey("sonarr")).toEqual({
      name: "Sonarr",
      baseUrl: "http://sonarr.env:8989",
      apiKey: "env-key",
    });
    expect(store.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "sonarr", baseUrl: "http://sonarr.env:8989", hasApiKey: true, source: "env" }),
        expect.objectContaining({ kind: "radarr", source: "gui" }),
      ]),
    );
  });
});
