import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type ArrOpsGlobal = typeof globalThis & {
  arrOps?: {
    invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  };
};

test("Electron app exposes the secure IPC bridge", async () => {
  const executablePath = process.env.ARR_OPS_ELECTRON_EXE;
  test.skip(!executablePath, "Set ARR_OPS_ELECTRON_EXE to a packaged ARR Ops executable.");

  const electronApp = await electron.launch({ executablePath, env: getElectronEnv() });
  const page = await electronApp.firstWindow();

  await page.waitForLoadState("domcontentloaded");

  await expectIpcBridge(page);

  const instances = await page.evaluate(() => (globalThis as ArrOpsGlobal).arrOps?.invoke("instances:list"));
  expect(instances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "sonarr" }),
      expect.objectContaining({ kind: "radarr" }),
    ]),
  );

  await electronApp.close();
});

test("packaged app can test Sonarr settings and run sample analysis through IPC", async ({}, testInfo) => {
  test.setTimeout(120_000);
  loadDotEnv();
  const executablePath = process.env.ARR_OPS_ELECTRON_EXE;
  const baseUrl = process.env.SONARR_URL;
  const apiKey = process.env.SONARR_API_KEY;
  test.skip(!executablePath, "Set ARR_OPS_ELECTRON_EXE to a packaged ARR Ops executable.");
  test.skip(!baseUrl || !apiKey, "Set SONARR_URL and SONARR_API_KEY in .env for live packaged Electron testing.");

  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${testInfo.outputPath("user-data")}`],
      env: getElectronEnv(),
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expectIpcBridge(page);

    const testResult = await page.evaluate(
      ({ baseUrl, apiKey }) =>
        (globalThis as ArrOpsGlobal).arrOps?.invoke("instances:test", {
          kind: "sonarr",
          name: "Sonarr",
          baseUrl,
          apiKey,
          enabled: true,
        }),
      { baseUrl, apiKey },
    );
    expect(testResult).toEqual(expect.objectContaining({ ok: true }));

    await page.evaluate(
      ({ baseUrl, apiKey }) =>
        (globalThis as ArrOpsGlobal).arrOps?.invoke("instances:save", {
          kind: "sonarr",
          name: "Sonarr",
          baseUrl,
          apiKey,
          enabled: true,
        }),
      { baseUrl, apiKey },
    );

    const job = await page.evaluate(() => (globalThis as ArrOpsGlobal).arrOps?.invoke("jobs:enqueue", { name: "Analyze one Sonarr series", target: "sonarr", sampleSize: 1 }));
    const jobId = typeof job === "object" && job !== null && "id" in job ? String(job.id) : "";
    await expect
      .poll(
        () =>
          page.evaluate(
            (jobId) =>
              (globalThis as ArrOpsGlobal).arrOps?.invoke("jobs:list").then((jobs) => (jobs as Array<{ id: string; status: string }>).find((item) => item.id === jobId)?.status),
            jobId,
          ),
        { timeout: 120_000 },
      )
      .toBe("completed");
    const rows = await page.evaluate(() => (globalThis as ArrOpsGlobal).arrOps?.invoke("library:sonarr"));

    expect(rows).toEqual([
      expect.objectContaining({
        episodes: expect.any(Number),
        funShare: expect.any(Number),
        title: expect.any(String),
      }),
    ]);
  } finally {
    await electronApp?.close();
  }
});

async function expectIpcBridge(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Boolean((globalThis as ArrOpsGlobal).arrOps)), {
      message: "window.arrOps should be exposed by the preload script",
    })
    .toBe(true);
}

function getElectronEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== "ELECTRON_RUN_AS_NODE" && value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    process.env[trimmed.slice(0, separator)] ??= trimmed.slice(separator + 1);
  }
}
