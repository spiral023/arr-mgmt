import type {
  AutomationGoalFilters,
  AutomationOrdering,
  AutomationWorkItemStatus,
  AutomationWorkItemView,
  InstanceKind,
} from "../../shared/ipc-contracts";

export type { AutomationGoalFilters, AutomationOrdering, AutomationWorkItemView };

export type AutomationMediaFile = {
  instanceId: number;
  instanceKind: InstanceKind;
  mediaItemId: number;
  mediaFileId: number | null;
  childArrId: number;
  kind: "episode" | "movie";
  title: string;
  sortKey: string;
  isFun: boolean;
  qualityName: string | null;
  releaseGroup: string | null;
  sizeBytes: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  monitored: boolean;
  hasFile: boolean;
  isExcluded: boolean;
  itemFunShare: number;
  lastAnalyzedAt: string | null;
  lastSearchedAt: string | null;
  lastGrabbedAt: string | null;
  qualityProfileName: string | null;
};

export type DesiredAutomationWorkItem = {
  instanceId: number;
  mediaItemId: number;
  mediaFileId: number | null;
  childArrId: number;
  kind: AutomationWorkItemView["kind"];
  title: string;
  sortKey: string;
  isFun: boolean;
  lastAnalyzedAt: string | null;
  lastSearchedAt: string | null;
  lastGrabbedAt: string | null;
  status: AutomationWorkItemStatus;
  now: Date;
};

export type AutomationWorkItemForOrdering = {
  instanceId: number;
  kind: AutomationWorkItemView["kind"];
  childArrId: number;
  mediaFileId: number | null;
  title: string;
  sortKey: string;
  itemFunShare: number;
  sizeBytes: number;
  lastSearchedAt: string | null;
};
