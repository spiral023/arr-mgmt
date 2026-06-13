import { expect, test } from "@playwright/test";

test("renders operational shell with sticky KPI bar, tabs, and tables", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ARR Ops" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByText("Search Budget")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze libraries" })).toBeVisible();

  await page.getByRole("button", { name: "Sonarr" }).click();
  await expect(page.getByRole("heading", { name: "Sonarr Series" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /FuN\* share/i })).toBeVisible();
  await expect(page.getByText("Criminal Record")).toBeVisible();

  const kpiBar = page.getByText("Search Budget").locator("..");
  await expect(kpiBar).toBeVisible();

  await page.getByRole("button", { name: "Radarr" }).click();
  await expect(page.getByRole("heading", { name: "Radarr Movies" })).toBeVisible();
  await expect(page.getByText("Nicht noch ein Teenie-Film")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "ARR Instances" })).toBeVisible();
  await expect(page.locator('input[value="http://192.168.0.170:8989"]')).toBeVisible();
  await expect(page.locator('input[value="http://192.168.0.170:7878"]')).toBeVisible();
});
