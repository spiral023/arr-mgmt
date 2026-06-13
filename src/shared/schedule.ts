import type { DateInput, ScheduleIntervalKind } from "./domain";

export type ScheduleRule = {
  intervalKind: ScheduleIntervalKind;
  intervalValue?: number;
  timeOfDay?: string;
};

const minutesToMs = 60 * 1000;
const hoursToMs = 60 * minutesToMs;
const daysToMs = 24 * hoursToMs;

export function calculateNextRunAt(rule: ScheduleRule, now: DateInput): Date {
  const current = toDate(now);

  switch (rule.intervalKind) {
    case "minutes":
      return addMilliseconds(current, getPositiveIntervalValue(rule) * minutesToMs);
    case "hours":
      return addMilliseconds(current, getPositiveIntervalValue(rule) * hoursToMs);
    case "days":
      return addMilliseconds(current, getPositiveIntervalValue(rule) * daysToMs);
    case "daily_time":
      return getNextDailyTime(current, rule.timeOfDay);
  }
}

function getNextDailyTime(now: Date, timeOfDay: string | undefined): Date {
  const { hours, minutes } = parseTimeOfDay(timeOfDay);
  const next = new Date(now.getTime());

  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function parseTimeOfDay(timeOfDay: string | undefined): { hours: number; minutes: number } {
  const match = timeOfDay?.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error("daily_time schedules require timeOfDay in HH:mm format");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    throw new Error("daily_time schedules require a valid HH:mm timeOfDay");
  }

  return { hours, minutes };
}

function getPositiveIntervalValue(rule: ScheduleRule): number {
  if (
    typeof rule.intervalValue !== "number" ||
    !Number.isInteger(rule.intervalValue) ||
    rule.intervalValue <= 0
  ) {
    throw new Error(`${rule.intervalKind} schedules require a positive integer intervalValue`);
  }

  return rule.intervalValue;
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function toDate(value: DateInput): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}
