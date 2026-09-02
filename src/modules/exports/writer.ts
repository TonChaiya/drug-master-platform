import { writeXls, type CellValue } from "@/lib/excel/biff-writer";
import { DRUGCAT_HEADERS, SHEET_NAME } from "@/modules/catalog/headers";
import type { ExportRow } from "./rows";

export class ExportContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExportContractError";
  }
}

const text = (value: string): CellValue => (value === "" ? { kind: "blank" } : { kind: "text", value });
const dateOrText = (value: string | null): CellValue => {
  if (!value) return { kind: "blank" };
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { kind: "date", value } : { kind: "text", value };
};

/**
 * Renders the export sheet.
 *
 * Every code column is written as text so leading zeros and 24-digit NDC values
 * survive; only `#` is numeric and the three date columns are real dates
 * formatted dd/mm/yyyy. The header row is emitted from the locked constant, and
 * verified again after building so a future edit cannot silently change it.
 */
export function buildDrugCatWorkbook(rows: ExportRow[]): Buffer {
  if (rows.length === 0) throw new ExportContractError("EXPORT_EMPTY", "ยังไม่มีรายการที่พร้อมส่งออก");

  const sheetRows: CellValue[][] = [DRUGCAT_HEADERS.map((header) => ({ kind: "text", value: header }) as CellValue)];

  rows.forEach((row, index) => {
    sheetRows.push([
      { kind: "number", value: index + 1 },
      text(row.hospdrugcode),
      text(row.productcat),
      text(row.tmtid),
      text(row.specprep),
      text(row.genericname),
      text(row.tradename),
      text(row.dfscode),
      text(row.dosageform),
      text(row.strength),
      text(row.content),
      text(row.unitprice),
      text(row.distributor),
      text(row.manufacturer),
      text(row.ised),
      text(row.ndc24),
      text(row.packsize),
      text(row.packprice),
      text(row.updateflag),
      dateOrText(row.datechange),
      dateOrText(row.dateupdate),
      dateOrText(row.dateeffective),
    ]);
  });

  const widthProblem = sheetRows.find((row) => row.length !== DRUGCAT_HEADERS.length);
  if (widthProblem) {
    throw new ExportContractError("EXPORT_COLUMN_COUNT", `ทุกแถวต้องมี ${DRUGCAT_HEADERS.length} คอลัมน์`);
  }

  return writeXls({ sheetName: SHEET_NAME, rows: sheetRows });
}

/** `{facilityCode}_drugcat_YYYYMMDD_HHmmss.xls`, stamped in Asia/Bangkok. */
export function exportFilename(facilityCode: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${facilityCode}_drugcat_${get("year")}${get("month")}${get("day")}_${get("hour")}${get("minute")}${get("second")}.xls`;
}
