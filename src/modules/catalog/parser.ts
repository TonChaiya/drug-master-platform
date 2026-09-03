/**
 * Parses an uploaded DrugCat workbook into validated rows.
 *
 * Everything here is defensive: the file arrives from a user, so the header row
 * is verified name by name and every value is length-capped before it can reach
 * the database.
 */

import { readFirstSheet } from "@/lib/excel/workbook";
import { cellText } from "@/lib/excel/sheet";
import { DRUGCAT_HEADERS, PAYLOAD_FIELDS, type PayloadField } from "./headers";

export const MAX_CATALOG_ROWS = 100_000;

/**
 * Two layouts exist in the field and both have to be accepted.
 *
 * The approved template (05957_drugcat_pass.xls) opens with a "#" display
 * counter, making the sheet 22 columns wide. The files the PHP system read and
 * wrote start straight at HOSPDRUGCODE and are 21 wide — its header contract
 * was literally that list. Demanding the counter rejected real, previously
 * accepted exports, so the first cell decides the offset instead. "#" is a
 * display counter in either layout and is never read as data.
 */
const COUNTER_HEADER = DRUGCAT_HEADERS[0];
const PAYLOAD_HEADERS = DRUGCAT_HEADERS.slice(1);

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

  const firstHeader = cellText(sheet, 0, 0);
  let columnOffset: number;
  if (firstHeader === COUNTER_HEADER) {
    columnOffset = 1;
  } else if (firstHeader === PAYLOAD_HEADERS[0]) {
    columnOffset = 0;
  } else {
    throw new CatalogParseError("CATALOG_HEADER_MISMATCH", "หัวตารางไม่ตรงกับแม่แบบ Drug Catalog", [
      `คอลัมน์แรกต้องเป็น "${COUNTER_HEADER}" (แบบ 22 คอลัมน์) หรือ "${PAYLOAD_HEADERS[0]}" (แบบ 21 คอลัมน์) แต่พบ "${firstHeader || "(ว่าง)"}"`,
    ]);
  }

  const headerProblems: string[] = [];
  PAYLOAD_HEADERS.forEach((expected, index) => {
    const actual = cellText(sheet, 0, columnOffset + index);
    if (actual !== expected) {
      headerProblems.push(`คอลัมน์ที่ ${columnOffset + index + 1} ต้องเป็น "${expected}" แต่พบ "${actual || "(ว่าง)"}"`);
    }
  });
  const extraHeader = cellText(sheet, 0, columnOffset + PAYLOAD_HEADERS.length);
  if (extraHeader) headerProblems.push(`พบคอลัมน์เกินหลัง "${PAYLOAD_HEADERS.at(-1)}": "${extraHeader}"`);

  if (headerProblems.length > 0) {
    const shape = columnOffset === 1 ? "22" : "21";
    throw new CatalogParseError("CATALOG_HEADER_MISMATCH", `หัวตารางไม่ตรงกับแม่แบบ ${shape} คอลัมน์ที่กำหนด`, headerProblems);
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
    PAYLOAD_FIELDS.forEach((field, fieldIndex) => {
      const raw = cellText(sheet, rowIndex, columnOffset + fieldIndex);
      if (raw !== "") hasAnyValue = true;
      values[field] = raw === "" ? null : raw.slice(0, FIELD_LIMITS[field]);
    });

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
