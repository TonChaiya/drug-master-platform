/**
 * Minimal BIFF8 (`.xls`) writer.
 *
 * Scope is exactly the DrugCat export contract: one worksheet, a fixed header
 * row, text / number / date / blank cells, Thai text, and codes that must stay
 * text so leading zeros survive (docs/SPEC.md).
 */

import { buildCompoundFile } from "./cfb-writer";
import { isoDateToExcelSerial as toSerial } from "./dates";

const MAX_RECORD_PAYLOAD = 8224;

const RECORD = {
  FORMULA: 0x0006,
  EOF: 0x000a,
  CONTINUE: 0x003c,
  WINDOW1: 0x003d,
  CODEPAGE: 0x0042,
  BOUNDSHEET: 0x0085,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  XF: 0x00e0,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  WINDOW2: 0x023e,
  DIMENSIONS: 0x0200,
  STYLE: 0x0293,
  FORMAT: 0x041e,
  FONT: 0x0031,
  BOF: 0x0809,
} as const;

const STYLE_XF_COUNT = 15;
/** Cell XF indexes handed to cell records. */
const XF_GENERAL = STYLE_XF_COUNT;
const XF_TEXT = STYLE_XF_COUNT + 1;
const XF_DATE = STYLE_XF_COUNT + 2;

const FORMAT_TEXT = 49; // built-in "@"
const FORMAT_DATE = 164; // first user-defined slot

export type CellValue =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: string } // ISO yyyy-mm-dd
  | { kind: "blank" };

export interface SheetInput {
  sheetName: string;
  rows: CellValue[][];
}

export class BiffWriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BiffWriteError";
  }
}

function record(id: number, payload: Buffer): Buffer {
  if (payload.length > MAX_RECORD_PAYLOAD) {
    throw new BiffWriteError("BIFF_RECORD_TOO_LONG", "record ยาวเกินกำหนดของรูปแบบ BIFF8");
  }
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

/** ISO date to the Excel 1900 serial; rejects anything Excel cannot represent. */
export function isoDateToExcelSerial(iso: string): number {
  const serial = toSerial(iso);
  if (serial === null) throw new BiffWriteError("BIFF_BAD_DATE", `รูปแบบวันที่ไม่ถูกต้อง: ${iso}`);
  return serial;
}

function fontRecord(bold: boolean): Buffer {
  const name = "Tahoma";
  const payload = Buffer.alloc(16 + name.length);
  payload.writeUInt16LE(200, 0); // 10pt
  payload.writeUInt16LE(0, 2);
  payload.writeUInt16LE(0x7fff, 4);
  payload.writeUInt16LE(bold ? 700 : 400, 6);
  payload.writeUInt16LE(0, 8);
  payload.writeUInt8(0, 10);
  payload.writeUInt8(0, 11);
  payload.writeUInt8(0, 12);
  payload.writeUInt8(0, 13);
  payload.writeUInt8(name.length, 14);
  payload.writeUInt8(0, 15); // compressed 8-bit characters
  payload.write(name, 16, "latin1");
  return record(RECORD.FONT, payload);
}

function xfRecord(fontIndex: number, formatIndex: number, isStyle: boolean): Buffer {
  const payload = Buffer.alloc(20);
  payload.writeUInt16LE(fontIndex, 0);
  payload.writeUInt16LE(formatIndex, 2);
  // fLocked | fStyle, with ixfParent 0xFFF for style records and 0 for cell records.
  payload.writeUInt16LE(isStyle ? 0xfff5 : 0x0001, 4);
  payload.writeUInt8(0x00, 6);
  payload.writeUInt8(0x00, 7);
  payload.writeUInt8(0x00, 8);
  // Cell XFs claim every attribute so the number format is taken from here,
  // not inherited from the parent style.
  payload.writeUInt8(isStyle ? 0x00 : 0xfc, 9);
  payload.writeUInt32LE(0, 10);
  payload.writeUInt32LE(0, 14);
  payload.writeUInt16LE(0, 18);
  return record(RECORD.XF, payload);
}

function shortUnicodeString(text: string): Buffer {
  const wide = [...text].some((character) => character.charCodeAt(0) > 0xff);
  const body = wide ? Buffer.from(text, "utf16le") : Buffer.from(text, "latin1");
  const header = Buffer.alloc(2);
  header.writeUInt8(text.length, 0);
  header.writeUInt8(wide ? 1 : 0, 1);
  return Buffer.concat([header, body]);
}

/**
 * Serialises the shared string table, splitting into CONTINUE records.
 *
 * Two BIFF8 rules drive the shape here: a string's 3-byte prefix may never
 * straddle a record boundary, and every continuation restarts with its own
 * encoding flag byte.
 */
function sharedStringTable(strings: string[], totalReferences: number): Buffer {
  const records: Buffer[] = [];
  let current: Buffer[] = [];
  let used = 0;

  const header = Buffer.alloc(8);
  header.writeUInt32LE(totalReferences, 0);
  header.writeUInt32LE(strings.length, 4);
  current.push(header);
  used = header.length;

  const flush = (): void => {
    records.push(Buffer.concat(current));
    current = [];
    used = 0;
  };

  for (const value of strings) {
    const wide = [...value].some((character) => character.charCodeAt(0) > 0xff);
    const units = wide ? Buffer.from(value, "utf16le") : Buffer.from(value, "latin1");
    const unitSize = wide ? 2 : 1;

    if (MAX_RECORD_PAYLOAD - used < 4 + unitSize) flush();

    const prefix = Buffer.alloc(3);
    prefix.writeUInt16LE(value.length, 0);
    prefix.writeUInt8(wide ? 1 : 0, 2);
    current.push(prefix);
    used += 3;

    let offset = 0;
    while (offset < units.length) {
      const room = MAX_RECORD_PAYLOAD - used;
      const takeUnits = Math.max(0, Math.floor(room / unitSize));
      const takeBytes = Math.min(units.length - offset, takeUnits * unitSize);
      if (takeBytes > 0) {
        current.push(units.subarray(offset, offset + takeBytes));
        offset += takeBytes;
        used += takeBytes;
      }
      if (offset < units.length) {
        flush();
        const continuationFlag = Buffer.alloc(1);
        continuationFlag.writeUInt8(wide ? 1 : 0, 0);
        current.push(continuationFlag);
        used = 1;
      }
    }
  }
  if (current.length > 0) flush();

  return Buffer.concat(
    records.map((payload, index) => record(index === 0 ? RECORD.SST : RECORD.CONTINUE, payload)),
  );
}

function bof(streamType: number): Buffer {
  const payload = Buffer.alloc(16);
  payload.writeUInt16LE(0x0600, 0);
  payload.writeUInt16LE(streamType, 2);
  payload.writeUInt16LE(0x0dbb, 4);
  payload.writeUInt16LE(0x07cc, 6);
  payload.writeUInt32LE(0x00000041, 8);
  payload.writeUInt32LE(0x00000006, 12);
  return record(RECORD.BOF, payload);
}

function labelSst(row: number, column: number, index: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUInt16LE(row, 0);
  payload.writeUInt16LE(column, 2);
  payload.writeUInt16LE(XF_TEXT, 4);
  payload.writeUInt32LE(index, 6);
  return record(RECORD.LABELSST, payload);
}

function numberCell(row: number, column: number, xf: number, value: number): Buffer {
  const payload = Buffer.alloc(14);
  payload.writeUInt16LE(row, 0);
  payload.writeUInt16LE(column, 2);
  payload.writeUInt16LE(xf, 4);
  payload.writeDoubleLE(value, 6);
  return record(RECORD.NUMBER, payload);
}

function blankCell(row: number, column: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt16LE(row, 0);
  payload.writeUInt16LE(column, 2);
  payload.writeUInt16LE(XF_GENERAL, 4);
  return record(RECORD.BLANK, payload);
}

export function writeXls(input: SheetInput): Buffer {
  if (input.rows.length === 0) throw new BiffWriteError("BIFF_NO_ROWS", "ไม่มีแถวสำหรับเขียนไฟล์");

  // --- Shared string table, deduplicated.
  const stringIndex = new Map<string, number>();
  const strings: string[] = [];
  let stringReferences = 0;
  for (const row of input.rows) {
    for (const cell of row) {
      if (cell.kind !== "text") continue;
      stringReferences += 1;
      if (!stringIndex.has(cell.value)) {
        stringIndex.set(cell.value, strings.length);
        strings.push(cell.value);
      }
    }
  }

  // --- Worksheet substream.
  const columnCount = input.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const dimensions = Buffer.alloc(14);
  dimensions.writeUInt32LE(0, 0);
  dimensions.writeUInt32LE(input.rows.length, 4);
  dimensions.writeUInt16LE(0, 8);
  dimensions.writeUInt16LE(columnCount, 10);
  dimensions.writeUInt16LE(0, 12);

  const window2 = Buffer.alloc(18);
  window2.writeUInt16LE(0x06b6, 0);
  window2.writeUInt32LE(0x00000040, 6);

  const cellRecords: Buffer[] = [];
  input.rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      switch (cell.kind) {
        case "text": {
          if (cell.value === "") {
            cellRecords.push(blankCell(rowIndex, columnIndex));
            break;
          }
          cellRecords.push(labelSst(rowIndex, columnIndex, stringIndex.get(cell.value)!));
          break;
        }
        case "number":
          cellRecords.push(numberCell(rowIndex, columnIndex, XF_GENERAL, cell.value));
          break;
        case "date":
          cellRecords.push(numberCell(rowIndex, columnIndex, XF_DATE, isoDateToExcelSerial(cell.value)));
          break;
        default:
          cellRecords.push(blankCell(rowIndex, columnIndex));
      }
    });
  });

  const worksheet = Buffer.concat([
    bof(0x0010),
    record(RECORD.DIMENSIONS, dimensions),
    ...cellRecords,
    record(RECORD.WINDOW2, window2),
    record(RECORD.EOF, Buffer.alloc(0)),
  ]);

  // --- Globals substream. BOUNDSHEET carries the worksheet's absolute offset,
  // so the globals are assembled twice: once to measure, once with the real value.
  const buildGlobals = (worksheetOffset: number): Buffer => {
    const codepage = Buffer.alloc(2);
    codepage.writeUInt16LE(0x04b0, 0);

    const window1 = Buffer.alloc(18);
    window1.writeUInt16LE(0x0000, 0);
    window1.writeUInt16LE(0x0000, 2);
    window1.writeUInt16LE(0x3a00, 4);
    window1.writeUInt16LE(0x2400, 6);
    window1.writeUInt16LE(0x0038, 8);
    window1.writeUInt16LE(0, 10);
    window1.writeUInt16LE(0, 12);
    window1.writeUInt16LE(1, 14);
    window1.writeUInt16LE(0x0258, 16);

    const dateFormat = Buffer.concat([Buffer.alloc(2), longUnicodeString("dd/mm/yyyy")]);
    dateFormat.writeUInt16LE(FORMAT_DATE, 0);

    const style = Buffer.alloc(4);
    style.writeUInt16LE(0x8000 | 0, 0);
    style.writeUInt8(0x00, 2);
    style.writeUInt8(0xff, 3);

    const boundsheet = Buffer.concat([Buffer.alloc(6), shortUnicodeString(input.sheetName)]);
    boundsheet.writeUInt32LE(worksheetOffset, 0);
    boundsheet.writeUInt16LE(0x0000, 4);

    const styleXfs = Array.from({ length: STYLE_XF_COUNT }, () => xfRecord(0, 0, true));

    return Buffer.concat([
      bof(0x0005),
      record(RECORD.CODEPAGE, codepage),
      record(RECORD.WINDOW1, window1),
      fontRecord(true),
      fontRecord(false),
      fontRecord(false),
      fontRecord(false),
      record(RECORD.FORMAT, dateFormat),
      ...styleXfs,
      xfRecord(1, 0, false), // XF_GENERAL
      xfRecord(1, FORMAT_TEXT, false), // XF_TEXT
      xfRecord(1, FORMAT_DATE, false), // XF_DATE
      record(RECORD.STYLE, style),
      record(RECORD.BOUNDSHEET, boundsheet),
      sharedStringTable(strings, stringReferences),
      record(RECORD.EOF, Buffer.alloc(0)),
    ]);
  };

  const measured = buildGlobals(0).length;
  const globals = buildGlobals(measured);
  if (globals.length !== measured) {
    throw new BiffWriteError("BIFF_OFFSET_UNSTABLE", "คำนวณตำแหน่ง worksheet ไม่นิ่ง");
  }

  return buildCompoundFile("Workbook", Buffer.concat([globals, worksheet]));
}

function longUnicodeString(text: string): Buffer {
  const wide = [...text].some((character) => character.charCodeAt(0) > 0xff);
  const body = wide ? Buffer.from(text, "utf16le") : Buffer.from(text, "latin1");
  const header = Buffer.alloc(3);
  header.writeUInt16LE(text.length, 0);
  header.writeUInt8(wide ? 1 : 0, 2);
  return Buffer.concat([header, body]);
}
