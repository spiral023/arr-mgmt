import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts?: Record<string, string>;
  build?: {
    extraMetadata?: {
      cliCompanion?: string;
    };
  };
};

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as PackageJson;
}

describe("CLI companion packaging", () => {
  it("builds arr-cli.exe after the packaged Electron app exists", () => {
    const pkg = readPackageJson();

    expect(pkg.scripts?.["build:cli-wrapper"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-cli-wrapper.ps1",
    );
    expect(pkg.scripts?.["dist:win"]).toContain("electron-builder --win portable --x64");
    expect(pkg.scripts?.["dist:win"]).toContain("npm run build:cli-wrapper");
    expect(pkg.build?.extraMetadata?.cliCompanion).toBe("arr-cli.exe");
  });
});
