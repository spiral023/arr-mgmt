import type { createRepositories } from "../db/repositories";
import type { AppSettings, AppSettingsInput } from "../../shared/ipc-contracts";

type Repositories = ReturnType<typeof createRepositories>;

const SETTINGS_KEY = "app.settings";

export const defaultAppSettings: AppSettings = {
  cooldownHours: { episodeSearch: 24, movieSearch: 24 },
  fun: { displayName: "FuN*", prefixes: ["fun"] },
  notifications: {
    jobFinished: true,
    quotaExhausted: true,
    candidatesFound: true,
  },
  quota: { searchLimit: 10000, grabLimit: 400, windowHours: 24 },
  tray: { keepRunningOnClose: true, showControls: true },
};

export function getAppSettings(repos: Repositories): AppSettings {
  return normalizeSettings(repos.settings.get<AppSettingsInput>(SETTINGS_KEY, {}));
}

export function updateAppSettings(repos: Repositories, input: AppSettingsInput): AppSettings {
  const next = normalizeSettings(mergeSettings(getAppSettings(repos), input));
  repos.settings.set(SETTINGS_KEY, next);
  return next;
}

function mergeSettings(current: AppSettings, input: AppSettingsInput): AppSettingsInput {
  return {
    cooldownHours: { ...current.cooldownHours, ...input.cooldownHours },
    fun: { ...current.fun, ...input.fun },
    notifications: { ...current.notifications, ...input.notifications },
    quota: { ...current.quota, ...input.quota },
    tray: { ...current.tray, ...input.tray },
  };
}

function normalizeSettings(input: AppSettingsInput): AppSettings {
  return {
    cooldownHours: {
      episodeSearch: positiveInteger(input.cooldownHours?.episodeSearch, defaultAppSettings.cooldownHours.episodeSearch),
      movieSearch: positiveInteger(input.cooldownHours?.movieSearch, defaultAppSettings.cooldownHours.movieSearch),
    },
    fun: {
      displayName: nonEmptyString(input.fun?.displayName, defaultAppSettings.fun.displayName),
      prefixes: normalizePrefixes(input.fun?.prefixes),
    },
    notifications: {
      jobFinished: booleanValue(input.notifications?.jobFinished, defaultAppSettings.notifications.jobFinished),
      quotaExhausted: booleanValue(input.notifications?.quotaExhausted, defaultAppSettings.notifications.quotaExhausted),
      candidatesFound: booleanValue(input.notifications?.candidatesFound, defaultAppSettings.notifications.candidatesFound),
    },
    quota: {
      searchLimit: positiveInteger(input.quota?.searchLimit, defaultAppSettings.quota.searchLimit),
      grabLimit: positiveInteger(input.quota?.grabLimit, defaultAppSettings.quota.grabLimit),
      windowHours: positiveInteger(input.quota?.windowHours, defaultAppSettings.quota.windowHours),
    },
    tray: {
      keepRunningOnClose: booleanValue(input.tray?.keepRunningOnClose, defaultAppSettings.tray.keepRunningOnClose),
      showControls: booleanValue(input.tray?.showControls, defaultAppSettings.tray.showControls),
    },
  };
}

function normalizePrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return defaultAppSettings.fun.prefixes;
  }
  const prefixes = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return prefixes.length > 0 ? [...new Set(prefixes)] : defaultAppSettings.fun.prefixes;
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
