/**
 * Parses an uploaded DrugCat workbook into validated rows.
 *
 * Everything here is defensive: the file arrives from a user, so the header row
 * is verified name by name and every value is length-capped before it can reach
 * the database.
 */

import { readFirstSheet } from "@/lib/excel/workbook";
import { cellText } from "@/lib/excel/sheet";
import { DRUGCAT_HEADERS, PAYLOAD_COLUMN_INDEX, PAYLOAD_FIELDS, type PayloadField } from "./headers";

export const MAX_CATALOG_ROWS = 100_000;

export type CatalogRowValues = Record<PayloadField, string | null>;

export interface ParsedCatalogRow {
  sourceRowNumber: number;
  values: CatalogRowValues;
}

export interface ParsedCatalog {
  sheetName: string;
  format: "xls" | "xlsx";
  rows: ParsedCatalogRow[];
  /** Rows skipped because they were entirely empty. */
  skippedEmptyRows: number;
}

export class CatalogParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: readonly string[],
  ) {
    super(message);
    this.name = "CatalogParseError";
  }
}

/** Per-field caps, matching the column widths in migration 0001. */
const FIELD_LIMITS: Record<PayloadField, number> = {
  hospdrugcode: 64,
  productcat: 8,
  tmtid: 64,
  specprep: 255,
  genericname: 4000,
  tradename: 255,
  dfscode: 64,
  dosageform: 255,
  strength: 255,
  content: 255,
  unitprice: 80,
  distributor: 255,
  manufacturer: 255,
  ised: 8,
  ndc24: 32,
  packsize: 120,
  packprice: 80,
  updateflag: 8,
  datechange: 32,
  dateupdate: 32,
  dateeffective: 32,
};

export function parseDrugCatalog(data: Buffer): ParsedCatalog {
  const sheet = readFirstSheet(data);

  const actualHeaders = DRUGCAT_HEADERS.map((_, index) => cellText(sheet, 0, index));
  const headerProblems: string[] = [];
  DRUGCAT_HEADERS.forEach((expected, index) => {
    if (actualHeaders[index] !== expected) {
      headerProblems.push(`คอลัมน์ที่ ${index + 1} ต้องเป็น "${expected}" แต่พบ "${actualHeaders[index] || "(ว่าง)"}"`);
    }
  });
  const extraHeader = cellText(sheet, 0, DRUGCAT_HEADERS.length);
  if (extraHeader) headerProblems.push(`พบคอลัมน์เกินหลัง "${DRUGCAT_HEADERS.at(-1)}": "${extraHeader}"`);

  if (headerProblems.length > 0) {
    throw new CatalogParseError("CATALOG_HEADER_MISMATCH", "หัวตารางไม่ตรงกับแม่แบบ 22 คอลัมน์ที่กำหนด", headerProblems);
  }

  const rows: ParsedCatalogRow[] = [];
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const missingCodes: number[] = [];
  let skippedEmptyRows = 0;

  for (let rowIndex = 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const sourceRowNumber = rowIndex + 1; // 1-based, matching what the user sees

    const values = {} as CatalogRowValues;
    let hasAnyValue = false;
    for (const field of PAYLOAD_FIELDS) {
      const raw = cellText(sheet, rowIndex, PAYLOAD_COLUMN_INDEX[field]);
      if (raw !== "") hasAnyValue = true;
      values[field] = raw === "" ? null : raw.slice(0, FIELD_LIMITS[field]);
    }

    if (!hasAnyValue) {
      skippedEmptyRows += 1;
      continue;
    }

    const code = values.hospdrugcode;
    if (!code) {
      missingCodes.push(sourceRowNumber);
      continue;
    }

    const previous = seen.get(code);
    if (previous !== undefined) {
      duplicates.push(`HOSPDRUGCODE "${code}" ซ้ำที่แถว ${previous} และ ${sourceRowNumber}`);
      continue;
    }
    seen.set(code, sourceRowNumber);

    rows.push({ sourceRowNumber, values });
    if (rows.length > MAX_CATALOG_ROWS) {
      throw new CatalogParseError("CATALOG_TOO_MANY_ROWS", `ไฟล์มีข้อมูลเกิน ${MAX_CATALOG_ROWS.toLocaleString("th-TH")} แถว`);
    }
  }

  if (missingCodes.length > 0) {
    throw new CatalogParseError(
      "CATALOG_MISSING_CODE",
      "มีแถวที่ไม่ได้ระบุ HOSPDRUGCODE",
      missingCodes.slice(0, 20).map((row) => `แถว ${row} ไม่มี HOSPDRUGCODE`),
    );
  }
  if (duplicates.length > 0) {
    throw new CatalogParseError("CATALOG_DUPLICATE_CODE", "พบ HOSPDRUGCODE ซ้ำกันในไฟล์เดียวกัน", duplicates.slice(0, 20));
  }
  if (rows.length === 0) {
    throw new CatalogParseError("CATALOG_EMPTY", "ไฟล์นี้ไม่มีแถวข้อมูล");
  }

  return { sheetName: sheet.sheetName, format: sheet.format, rows, skippedEmptyRows };
}
