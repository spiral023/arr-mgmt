export const DEFAULT_FUN_PREFIXES: readonly string[] = ["fun"];

export function isFunReleaseGroup(
  value: string | null | undefined,
  prefixes: readonly string[] = DEFAULT_FUN_PREFIXES,
): boolean {
  const releaseGroup = value?.trim().toLowerCase();

  if (!releaseGroup) {
    return false;
  }

  return prefixes
    .map((prefix) => prefix.trim().toLowerCase())
    .filter((prefix) => prefix.length > 0)
    .some((prefix) => releaseGroup.startsWith(prefix));
}
