export function extractDownloadId(value: unknown): string | undefined {
  if (value && typeof value === "object" && "downloadId" in value && typeof value.downloadId === "string" && value.downloadId) {
    return value.downloadId;
  }
  return undefined;
}
