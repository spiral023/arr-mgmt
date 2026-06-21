export type PageInfo = { total: number; shown: number; offset: number };

export type CommandResult =
  | { ok: true; hint: string; data: unknown; page?: PageInfo }
  | { ok: false; hint: string; error: { message: string; code: string } };

export function ok(data: unknown, hint: string, page?: PageInfo): CommandResult {
  return page ? { ok: true, hint, data, page } : { ok: true, hint, data };
}

export function fail(code: string, message: string, hint: string): CommandResult {
  return { ok: false, hint, error: { code, message } };
}

export function paginate<T>(items: T[], offset: number, limit: number): { slice: T[]; page: PageInfo } {
  const safeOffset = Math.max(0, Math.trunc(offset));
  const slice = items.slice(safeOffset, safeOffset + limit);
  return { slice, page: { total: items.length, shown: slice.length, offset: safeOffset } };
}

export function pickFields<T extends object>(row: T, fields: ReadonlyArray<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const field of fields) {
    out[field] = row[field];
  }
  return out;
}

export function render(result: CommandResult, pretty: boolean): string {
  return JSON.stringify(result, null, pretty ? 2 : undefined);
}
