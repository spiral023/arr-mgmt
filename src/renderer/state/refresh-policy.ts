import type { AppTabId } from "../components/TabNav";

export function shouldRefreshSonarrRows(activeTab: AppTabId): boolean {
  return activeTab === "sonarr";
}

export function shouldRefreshRadarrRows(activeTab: AppTabId): boolean {
  return activeTab === "radarr";
}
