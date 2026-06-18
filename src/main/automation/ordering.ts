import type { AutomationOrdering } from "../../shared/ipc-contracts";
import type { AutomationWorkItemForOrdering } from "./automation-types";

export function orderAutomationWorkItems<T extends AutomationWorkItemForOrdering>(items: T[], ordering: AutomationOrdering): T[] {
  const ordered = [...items];

  switch (ordering) {
    case "oldest_search_first":
      return ordered.sort(compareOldestSearchFirst);
    case "lowest_fun_share_first":
      return ordered.sort((a, b) => a.itemFunShare - b.itemFunShare || compareAlphabetical(a, b));
    case "largest_impact_first":
      return ordered.sort((a, b) => b.sizeBytes - a.sizeBytes || compareAlphabetical(a, b));
    case "alphabetical":
      return ordered.sort(compareAlphabetical);
  }
}

function compareOldestSearchFirst(a: AutomationWorkItemForOrdering, b: AutomationWorkItemForOrdering): number {
  if (a.lastSearchedAt != null && b.lastSearchedAt != null) {
    return new Date(a.lastSearchedAt).getTime() - new Date(b.lastSearchedAt).getTime() || compareAlphabetical(a, b);
  }
  if (a.lastSearchedAt != null) return -1;
  if (b.lastSearchedAt != null) return 1;
  return compareAlphabetical(a, b);
}

function compareAlphabetical(a: AutomationWorkItemForOrdering, b: AutomationWorkItemForOrdering): number {
  return a.sortKey.localeCompare(b.sortKey) || a.title.localeCompare(b.title);
}
