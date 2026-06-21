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
  "automation",
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
};

export function parseIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
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
      ids: { type: "string" },
      limit: { type: "string" },
      offset: { type: "string" },
      sample: { type: "string" },
      full: { type: "boolean" },
      pretty: { type: "boolean" },
      quiet: { type: "boolean" },
      "non-fun-only": { type: "boolean" },
    },
  });

  return {
    verb: positionals[0] ?? "help",
    sub: positionals[1],
    rest: positionals.slice(2),
    ids: parseIds(values.ids as string | undefined),
    limit: toInt(values.limit as string | undefined),
    offset: toInt(values.offset as string | undefined),
    sample: toInt(values.sample as string | undefined),
    full: Boolean(values.full),
    pretty: Boolean(values.pretty),
    quiet: Boolean(values.quiet),
    nonFunOnly: Boolean(values["non-fun-only"]),
  };
}
