import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1366, height: 900 }, { width: 414, height: 896 }]) {
test(`large library and job logs stay usable at ${viewport.width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const job = { id: "large-job", name: "Large analysis", kind: "analysis", target: "sonarr", status: "running",
      progressCurrent: 2000, progressTotal: 2573, successCount: 2000, failureCount: 0,
      createdAt: "2026-10-20T10:00:00Z", startedAt: "2026-10-20T10:00:00Z" };
    window.arrOps = {
      onJobEvent: () => () => {},
      invoke: async (channel: string) => {
        if (channel === "library:sonarr") return Array.from({ length: 8000 }, (_, i) => ({
          id: `series-${i + 1}`, arrId: i + 1, title: `Stress series ${String(i + 1).padStart(5, "0")}`,
          monitored: true, episodes: 30, files: 30, funFiles: 10, nonFunFiles: 20, funShare: 1 / 3,
          pendingFunCandidates: 0, totalSizeBytes: 1e9, hasFiles: true, lastAnalyzed: "20.10.2026 12:00", lastSearched: "-", lastGrabbed: "-", status: "searchable",
        }));
        if (channel === "jobs:list") return [job];
        if (channel === "jobs:events") return Array.from({ length: 10000 }, (_, i) => ({
          jobId: job.id, level: i % 10 === 0 ? "warning" : "info", createdAt: new Date(1792490400000 + i * 1000).toISOString(),
          message: `Stress event ${i + 1}: ${"Measured job output with a longer release title. ".repeat(i % 4 + 1)}`,
        }));
        if (channel === "settings:get") return { onboardingCompleted: true };
        if (channel === "quota:summary") return { search: { used: 0, remaining: 10000, limit: 10000 }, grab: { used: 0, remaining: 400, limit: 400 } };
        if (channel === "library:summary") return { totalSeries: 8000, totalMovies: 0, totalFiles: 240000, totalSizeBytes: 8e12, funFiles: 80000, funShare: 1 / 3, sonarrFunShare: 1 / 3, radarrFunShare: 0, sonarrPendingFunCandidates: 0, radarrPendingFunCandidates: 0, successfulGrabs: 0 };
        return [];
      },
    } as unknown as typeof window.arrOps;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sonarr", exact: true }).click();
  const search = page.getByPlaceholder("Search series");
  await expect(search).toBeVisible();
  await expect(page.getByText("Stress series 00001", { exact: true })).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBeLessThan(100);
  await search.fill("Stress series 07999");
  await expect(page.getByText("Stress series 07999", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  const log = page.getByLabel("Job events", { exact: true });
  await expect(log.getByText(/^Stress event 1:/)).toBeVisible();
  expect(await log.locator("[data-index]").count()).toBeLessThan(100);
  await log.focus(); await page.keyboard.press("Control+End");
  await expect(log.getByText(/^Stress event 10000:/)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copiedLogLines = String(text.split("\n").length); },
    } });
  });
  await page.getByRole("button", { name: "Copy job log to clipboard" }).click();
  await expect(page.getByRole("button", { name: /Full log/ })).toBeVisible();
  await page.getByRole("button", { name: /Full log/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-copied-log-lines", "10001");
  await page.screenshot({ path: testInfo.outputPath("large-job-log.png"), fullPage: true });
});
}
