import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1366, height: 900 }, { width: 414, height: 896 }]) {
  test(`reads and paginates ARR worklists at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Radarr", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Radarr Movies" })).toBeVisible();
    await page.evaluate(() => {
      window.arrOps = {
        onJobEvent: () => () => {},
        invoke: async (channel: string, payload: unknown) => {
          if (channel === "library:wanted") {
            const { mode, page: currentPage } = payload as { mode: string; page: number };
            return { totalRecords: mode === "missing" ? 23 : 1, records: mode === "missing" ?
              Array.from({ length: currentPage === 1 ? 20 : 3 }, (_, index) => ({ id: currentPage * 100 + index, title: `Worklist movie ${(currentPage - 1) * 20 + index + 1}` })) :
              [{ id: 900, title: "Below profile cutoff", movieFile: { quality: { quality: { name: "WEBDL-720p" } } } }] };
          }
          if (channel === "quota:summary") return { search: { used: 0, remaining: 100, limit: 100 }, grab: { used: 0, remaining: 100, limit: 100 } };
          if (channel === "library:summary") return { totalSeries: 0, totalMovies: 0, funFiles: 0, funShare: 0, sonarrFunShare: 0, radarrFunShare: 0, successfulGrabs: 0 };
          return [];
        },
      } as unknown as typeof window.arrOps;
    });
    const disclosure = page.getByText("Fehlende Dateien und Qualitätsziele", { exact: true });
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("23 Einträge · Seite 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Nächste Seite" }).click();
    await expect(page.getByText("Worklist movie 21", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nächste Seite" })).toBeDisabled();
    await page.getByRole("button", { name: "Unter Qualitätsziel", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Below profile cutoff" })).toBeVisible();
    await expect(page.getByText("WEBDL-720p", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("worklist.png"), fullPage: true });
  });
}
