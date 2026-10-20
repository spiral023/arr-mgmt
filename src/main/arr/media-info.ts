import type { ArrMediaInfo } from "./arr-types";
import type { FileMediaInfo } from "../../shared/ipc-contracts";

// Sonarr/Radarr serialize runtime as m:ss or h:mm:ss, sometimes a .NET day prefix.
export function parseRuntimeSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(?:(\d+)\.)?(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(value.trim());
  if (!match) return null;
  const [, days, first, second, third] = match;
  if (+second >= 60 || (third !== undefined && +third >= 60) || (days && third === undefined)) return null;
  const seconds = third === undefined ? +first * 60 + +second : +(days ?? 0) * 86400 + +first * 3600 + +second * 60 + +third;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function normalizeMediaInfo(info: ArrMediaInfo | undefined, sizeBytes: number): FileMediaInfo {
  const runtimeSeconds = parseRuntimeSeconds(info?.runTime);
  const canCalculate = runtimeSeconds !== null && Number.isFinite(sizeBytes) && sizeBytes > 0;
  const text = (value: string | null | undefined) => value?.trim() || null;
  return {
    runtimeSeconds,
    totalBitrateMbps: canCalculate ? sizeBytes * 8 / runtimeSeconds / 1_000_000 : null,
    megabytesPerMinute: canCalculate ? sizeBytes / 1_000_000 / (runtimeSeconds / 60) : null,
    videoBitrateMbps: info?.videoBitrate && info.videoBitrate > 0 ? info.videoBitrate / 1_000_000 : null,
    videoCodec: text(info?.videoCodec), audioCodec: text(info?.audioCodec),
    audioLanguages: text(info?.audioLanguages), resolution: text(info?.resolution),
  };
}
