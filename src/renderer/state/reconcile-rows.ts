/** Preserve table models and row selection when polling returns unchanged data. */
export function reconcileRows<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const byId = new Map(previous.map((row) => [row.id, row]));
  let unchanged = previous.length === next.length;
  const rows = next.map((row, index) => {
    const old = byId.get(row.id);
    const keys = Object.keys(row) as Array<keyof T>;
    const same = old && Object.keys(old).length === keys.length && keys.every((key) => Object.is(old[key], row[key]));
    const resolved = same ? old : row;
    if (resolved !== previous[index]) unchanged = false;
    return resolved;
  });
  return unchanged ? previous : rows;
}
