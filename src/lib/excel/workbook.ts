/** Format detection + a single entry point for reading an uploaded workbook. */

import { CompoundFile } from "./cfb-reader";
import { readXlsSheet } from "./biff-reader";
import { readXlsxSheet } from "./xlsx-reader";
import { isZip } from "./zip-reader";
import type { SheetGrid } from "./sheet";

export type WorkbookFormat = "xls" | "xlsx";

export class WorkbookError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkbookError";
  }
}

/**
 * Detects the format from the file signature, never the extension —
 * docs/SPEC.md requires this.
 */
export function detectWorkbookFormat(data: Buffer): WorkbookFormat {
  if (CompoundFile.isCompoundFile(data)) return "xls";
  if (isZip(data)) return "xlsx";
  throw new WorkbookError("WORKBOOK_FORMAT", "ไฟล์นี้ไม่ใช่ .xls หรือ .xlsx ที่ถูกต้อง");
}

export function readFirstSheet(data: Buffer): SheetGrid & { format: WorkbookFormat } {
  const format = detectWorkbookFormat(data);
  const grid = format === "xls" ? readXlsSheet(data) : readXlsxSheet(data);
  return { ...grid, format };
}
