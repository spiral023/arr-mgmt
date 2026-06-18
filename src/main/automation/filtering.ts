import type { AutomationGoalFilters, AutomationRecencyFilter, AutomationTriState } from "../../shared/ipc-contracts";
import type { AutomationMediaFile } from "./automation-types";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export function matchesAutomationFilters(
  file: AutomationMediaFile,
  filters: AutomationGoalFilters,
  now = new Date(),
): boolean {
  return (
    matchesTriState(file.monitored, filters.monitored) &&
    matchesTriState(file.hasFile, filters.hasFile) &&
    matchesQualityProfile(file.qualityProfileName, filters.qualityProfiles) &&
    matchesFunShare(file.itemFunShare, filters.funShare) &&
    matchesRecency(file.lastAnalyzedAt, filters.analyzed, now) &&
    matchesRecency(file.lastSearchedAt, filters.searched, now) &&
    matchesRecency(file.lastGrabbedAt, filters.grabbed, now)
  );
}

function matchesTriState(value: boolean, filter: AutomationTriState): boolean {
  if (filter === "either") return true;
  return filter === "yes" ? value : !value;
}

function matchesQualityProfile(qualityProfileName: string | null, qualityProfiles: string[]): boolean {
  return qualityProfiles.length === 0 || (qualityProfileName != null && qualityProfiles.includes(qualityProfileName));
}

function matchesFunShare(value: number, filter: AutomationGoalFilters["funShare"]): boolean {
  if (filter == null) return true;

  switch (filter.operator) {
    case "lt":
      return value < filter.value;
    case "lte":
      return value <= filter.value;
    case "gt":
      return value > filter.value;
    case "gte":
      return value >= filter.value;
  }
}

function matchesRecency(timestamp: string | null, filter: AutomationRecencyFilter, now: Date): boolean {
  if (filter.mode === "any") return true;
  if (timestamp == null) return filter.mode === "never";
  if (filter.mode === "never") return false;

  const timestampTime = new Date(timestamp).getTime();
  const cutoffTime = now.getTime() - filter.days * millisecondsPerDay;

  if (filter.mode === "older_than") return timestampTime < cutoffTime;
  return timestampTime >= cutoffTime;
}
