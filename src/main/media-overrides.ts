export function filterOutExcluded<T>(
  items: T[],
  excludedItemIds: Set<number>,
  getMediaItemId: (item: T) => number | null | undefined,
): T[] {
  if (excludedItemIds.size === 0) {
    return items;
  }
  return items.filter((item) => {
    const mediaItemId = getMediaItemId(item);
    return mediaItemId == null || !excludedItemIds.has(mediaItemId);
  });
}
