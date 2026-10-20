import { parseArgs } from "node:util";

export const KNOWN_VERBS = [
  "library",
  "item",
  "quota",
  "stats",
  "activity",
  "jobs",
  "instances",
  "analyze",
  "search",
  "grab",
  "pipeline",
  "missing",
  "automation",
  "wanted",
  "transfers",
  "parse",
  "help",
] as const;

export type ParsedArgs = {
  verb: string;
  sub?: string;
  rest: string[];
  ids: number[];
  limit?: number;
  offset?: number;
  sample?: number;
  full: boolean;
  pretty: boolean;
  quiet: boolean;
  nonFunOnly: boolean;
  grab: boolean;
  idType: "auto" | "arr" | "tmdb" | "tvdb";
  refresh: boolean;
};

export function parseIds(value: string | string[] | undefined): number[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((entry) => entry.split(","))
    .map((part) => {
      const trimmed = part.trim();
      const n = Number(trimmed);
      if (Number.isSafeInteger(n)) return n;
      const urlId = trimmed.match(/\/(?:movie|series)\/(\d+)(?:[/?#]|$)/i);
      return urlId ? Number(urlId[1]) : Number.NaN;
    })
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

function firstPositional(userArgs: string[]): string | undefined {
  return userArgs.find((arg) => !arg.startsWith("-"));
}

export function isCliInvocation(userArgs: string[]): boolean {
  if (userArgs.includes("--cli")) return true;
  const first = firstPositional(userArgs);
  return first != null && (KNOWN_VERBS as readonly string[]).includes(first);
}

function toInt(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

export function parseCliArgs(userArgs: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: userArgs,
    allowPositionals: true,
    options: {
      cli: { type: "boolean" },
      help: { type: "boolean" },
      ids: { type: "string", multiple: true },
      limit: { type: "string" },
      offset: { type: "string" },
      sample: { type: "string" },
      full: { type: "boolean" },
      pretty: { type: "boolean" },
      quiet: { type: "boolean" },
      grab: { type: "boolean" },
      "non-fun-only": { type: "boolean" },
      "id-type": { type: "string" },
      refresh: { type: "boolean" },
    },
  });

  const idType = values["id-type"] ?? "auto";
  if (!["auto", "arr", "tmdb", "tvdb"].includes(idType)) throw new Error("--id-type erwartet auto|arr|tmdb|tvdb");
  for (const flag of ["limit", "offset", "sample"] as const) {
    if (values[flag] !== undefined && (!Number.isSafeInteger(Number(values[flag])) || Number(values[flag]) < (flag === "offset" ? 0 : 1))) {
      throw new Error(`--${flag} muss eine ${flag === "offset" ? "nicht negative" : "positive"} ganze Zahl sein`);
    }
  }
  for (const value of values.ids ?? []) {
    if (value.split(",").some((part) => parseIds(part).length !== 1)) throw new Error("--ids enthält eine ungültige ID");
  }

  return {
    verb: values.help ? "help" : (positionals[0] ?? "help"),
    sub: positionals[1],
    rest: positionals.slice(2),
    ids: parseIds(values.ids as string[] | undefined),
    limit: toInt(values.limit as string | undefined),
    offset: toInt(values.offset as string | undefined),
    sample: toInt(values.sample as string | undefined),
    full: Boolean(values.full),
    pretty: Boolean(values.pretty),
    quiet: Boolean(values.quiet),
    nonFunOnly: Boolean(values["non-fun-only"]),
    grab: Boolean(values.grab),
    idType: idType as ParsedArgs["idType"],
    refresh: Boolean(values.refresh),
  };
}
