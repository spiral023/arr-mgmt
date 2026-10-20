const dateFormatter = new Intl.DateTimeFormat();
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const formattedDates = new Map<string, string>();
const CACHE_LIMIT = 4096;

/** Reuse ICU formatters and repeated timestamps across large library refreshes. */
export function formatDateTime(value?: string): string {
  if (!value || value === "-") return "-";
  const cached = formattedDates.get(value);
  if (cached !== undefined) return cached;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  const result = `${dateFormatter.format(date)} ${timeFormatter.format(date)}`;
  if (formattedDates.size >= CACHE_LIMIT) formattedDates.delete(formattedDates.keys().next().value!);
  formattedDates.set(value, result);
  return result;
}
