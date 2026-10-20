import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { IpcChannel, JobView } from "../../src/shared/ipc-contracts";

function invoke<T>(page: Page, channel: IpcChannel, payload?: unknown): Promise<T> {
  return page.evaluate(({ channel, payload }) => window.arrOps.invoke<T>(channel, payload), { channel, payload });
}

async function waitForJob(page: Page, id: string, status = "completed") {
  await expect.poll(async () => (await invoke<JobView[]>(page, "jobs:list")).find((job) => job.id === id)?.status,
    { timeout: 20_000 }).toBe(status);
}

test("packaged release safely selects an episode, cancels reads, and persists scheduler pause", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const executablePath = process.env.ARR_OPS_ELECTRON_EXE;
  test.skip(!executablePath, "Set ARR_OPS_ELECTRON_EXE to test the packaged release with a local fake ARR.");
  const original = { guid: "episode-5", title: "Audit.S01E05-FuN", releaseGroup: "FuN", indexerId: 1, rejected: false, downloadAllowed: true };
  const replacement = { ...original, guid: "replacement-5", title: "Audit.S01E05.REPACK-FuN" };
  const posts: Array<{ guid: string }> = [];
  let episodeSearches = 0;
  let holdSearch = false;
  let heldResponse: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      posts.push(JSON.parse(body));
      response.end(JSON.stringify({ downloadId: "synthetic-accepted" }));
    } else if (url.pathname === "/api/v3/series/1") {
      response.end(JSON.stringify({ id: 1, title: "Audit", monitored: true, qualityProfileId: 1 }));
    } else if (url.pathname === "/api/v3/episode") {
      response.end(JSON.stringify([{ id: 105, seriesId: 1, seasonNumber: 1, episodeNumber: 5, hasFile: true,
        episodeFile: { id: 115, releaseGroup: "Other", size: 1000 } }]));
    } else if (url.pathname === "/api/v3/release") {
      if (url.searchParams.has("seasonNumber")) {
        response.end(JSON.stringify([{ ...original, rejected: true, downloadAllowed: false },
          { ...original, guid: "wrong-episode", title: "Audit.S01E01-FuN" }]));
      } else {
        episodeSearches++;
        if (holdSearch) { heldResponse = response; return; }
        response.end(JSON.stringify([episodeSearches === 1 ? original : replacement]));
      }
    } else if (url.pathname === "/api/v3/qualityprofile") {
      response.end(JSON.stringify([{ id: 1, name: "HD" }]));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: `Unexpected test request: ${url.pathname}` }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const profile = testInfo.outputPath("isolated-user-data");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined)) as Record<string, string>;
  const launch = () => electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(profile);
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe("0.1.2");
    let page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => Boolean(window.arrOps))).toBe(true);
    await invoke(page, "onboarding:complete");
    await invoke(page, "instances:save", { kind: "sonarr", name: "Local test", baseUrl, apiKey: "synthetic-key", enabled: true });
    await page.reload();
    const analysis = await invoke<JobView>(page, "jobs:enqueue", { target: "sonarr", seriesIds: [1] });
    await waitForJob(page, analysis.id);
    const search = await invoke<{ jobId: string }>(page, "sonarr:search", { seriesIds: [1] });
    await waitForJob(page, search.jobId);
    const grab = await invoke<{ jobId: string }>(page, "sonarr:grab", { seriesIds: [1] });
    await waitForJob(page, grab.jobId);
    expect(posts).toEqual([expect.objectContaining({ guid: "replacement-5" })]);
    expect(episodeSearches).toBe(2);

    await invoke(page, "settings:update", { cooldownHours: { episodeSearch: 0 } });
    holdSearch = true;
    const cancelled = await invoke<{ jobId: string }>(page, "sonarr:search", { seriesIds: [1] });
    await expect.poll(() => Boolean(heldResponse)).toBe(true);
    await invoke(page, "jobs:cancel", { jobId: cancelled.jobId });
    await expect.poll(async () => (await invoke<JobView[]>(page, "jobs:list")).find((job) => job.id === cancelled.jobId)?.finishedAt).toBeTruthy();
    expect(posts).toHaveLength(1);

    await page.getByRole("button", { name: "Pause scheduler", exact: true }).click();
    await expect.poll(() => invoke(page, "scheduler:getState")).toEqual({ paused: true });
    await expect(page.getByRole("button", { name: "Resume scheduler", exact: true })).toBeVisible();
    await invoke(page, "automation:saveGoal", {
      name: "Paused startup must not run", enabled: true, runOnStartup: true, scope: "sonarr",
      targetFunShare: 0.95, actionMode: "search_only", executionStrategy: "grab_immediately",
      ordering: "alphabetical", minSearchIntervalHours: 0, schedule: null,
      filters: { monitored: "yes", hasFile: "yes", qualityProfiles: [], funShare: { operator: "lt", value: 1 },
        analyzed: { mode: "any" }, searched: { mode: "any" }, grabbed: { mode: "any" } },
    });
    const jobsBeforeRestart = (await invoke<JobView[]>(page, "jobs:list")).length;
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Resume scheduler", exact: true })).toBeVisible();
    expect(await invoke<JobView[]>(page, "jobs:list")).toHaveLength(jobsBeforeRestart);
    await invoke(page, "scheduler:setPaused", { paused: false });
    await expect(page.getByRole("button", { name: "Pause scheduler", exact: true })).toBeVisible();
  } finally {
    heldResponse?.destroy();
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
