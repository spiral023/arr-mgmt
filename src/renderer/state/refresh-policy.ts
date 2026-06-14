import type { AppTabId } from "../components/TabNav";

export function shouldRefreshSonarrRows(activeTab: AppTabId): boolean {
  return activeTab === "sonarr";
}
