export interface TmtDateWindow {
  begindate: string;
  enddate: string;
}

const DAY_MS = 86_400_000;
export const TMT_HISTORY_START = "2013-01-01";

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ISO date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ISO date: ${value}`);
  return date;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

export function partitionHistoricalWindows(begin: string, end: string, maximumDays = 365): TmtDateWindow[] {
  if (!Number.isInteger(maximumDays) || maximumDays < 1) throw new Error("maximumDays must be a positive integer");
  const finalDate = parseDate(end);
  let cursor = parseDate(begin);
  if (cursor > finalDate) return [];
  const windows: TmtDateWindow[] = [];
  while (cursor <= finalDate) {
    const candidate = addDays(cursor, maximumDays - 1);
    const windowEnd = candidate < finalDate ? candidate : finalDate;
    windows.push({ begindate: isoDate(cursor), enddate: isoDate(windowEnd) });
    cursor = addDays(windowEnd, 1);
  }
  return windows;
}

export function incrementalWindow(latestSuccessfulEnd: string | null, end: string, overlapDays = 30): TmtDateWindow {
  if (!Number.isInteger(overlapDays) || overlapDays < 1) throw new Error("overlapDays must be a positive integer");
  const finalDate = parseDate(end);
  const begin = latestSuccessfulEnd ? addDays(parseDate(latestSuccessfulEnd), -(overlapDays - 1)) : parseDate(TMT_HISTORY_START);
  const boundedBegin = begin < parseDate(TMT_HISTORY_START) ? parseDate(TMT_HISTORY_START) : begin;
  if (boundedBegin > finalDate) throw new Error("incremental begin date is after end date");
  return { begindate: isoDate(boundedBegin), enddate: isoDate(finalDate) };
}

export function bangkokDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
