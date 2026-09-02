/**
 * Excel's 1900 date system. The serial numbers deliberately include a
 * non-existent 29 Feb 1900, so every serial above 59 is one day ahead of a naive
 * day count — both directions must apply the same shift or dates drift by a day.
 */

const MAX_SERIAL = 2_958_465; // 31 Dec 9999
const EPOCH_UTC = Date.UTC(1899, 11, 31);

export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > MAX_SERIAL) return null;
  const days = Math.floor(serial);
  const shifted = days > 59 ? days - 1 : days;
  return new Date(EPOCH_UTC + shifted * 86_400_000).toISOString().slice(0, 10);
}

export function isoDateToExcelSerial(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(utc)) return null;
  const days = Math.round((utc - EPOCH_UTC) / 86_400_000);
  if (days <= 0 || days > MAX_SERIAL) return null;
  return days >= 60 ? days + 1 : days;
}

/** Built-in number-format ids that Excel renders as a date or time. */
export const BUILTIN_DATE_FORMAT_IDS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
  57, 58,
]);

/** Detects a date format code after stripping literals, colours and conditions. */
export function looksLikeDateFormat(format: string): boolean {
  const stripped = format
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "");
  return /[dmyh]/i.test(stripped) && /(dd|mm|yy|yyyy|d\/|m\/|h:)/i.test(stripped);
}
