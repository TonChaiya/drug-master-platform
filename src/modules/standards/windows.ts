/**
 * Date-window partitioning for the initial MasterTMT sync.
 *
 * Splitting into at most one-year windows is an implementation safety rule, not
 * something the API demands: it keeps each request retryable and makes the
 * reconciliation count per partition meaningful (docs/SPEC.md).
 */

export interface SyncWindow {
  begindate: string;
  enddate: string;
}

const MAX_WINDOW_DAYS = 365;

/**
 * First date worth asking for.
 *
 * Probed against the live API: /mastertmt returns nothing for any window before
 * November 2013, where the initial 9,604-row load sits, and /concept reports no
 * change_date earlier than 2013-06-27. Starting on 1 January 2013 covers that
 * with one cheap empty window rather than guessing a tighter bound.
 */
export const TMT_DATA_START = "2013-01-01";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function partitionWindows(beginIso: string, endIso: string, maxDays = MAX_WINDOW_DAYS): SyncWindow[] {
  const begin = Date.parse(`${beginIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(begin) || !Number.isFinite(end)) throw new Error("INVALID_WINDOW_DATES");
  if (begin > end) throw new Error("WINDOW_BEGIN_AFTER_END");

  const windows: SyncWindow[] = [];
  let cursor = begin;
  while (cursor <= end) {
    const windowEnd = Math.min(cursor + (maxDays - 1) * 86_400_000, end);
    windows.push({ begindate: toIso(new Date(cursor)), enddate: toIso(new Date(windowEnd)) });
    cursor = windowEnd + 86_400_000;
  }
  return windows;
}
