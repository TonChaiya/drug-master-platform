/**
 * BIFF8 (`.xls`) worksheet reader. Handles only what the DrugCat contract needs:
 * shared and inline strings, numbers, RK-encoded numbers, blanks, cached formula
 * values, and enough format bookkeeping to tell a date cell from a plain number.
 */

import { CompoundFile } from "./cfb-reader";
import { BUILTIN_DATE_FORMAT_IDS, excelSerialToIsoDate, looksLikeDateFormat } from "./dates";
import type { SheetGrid } from "./sheet";

const RECORD = {
  FORMULA: 0x0006,
  EOF: 0x000a,
  CONTINUE: 0x003c,
  BOUNDSHEET: 0x0085,
  MULRK: 0x00bd,
  MULBLANK: 0x00be,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  STRING: 0x0207,
  RK: 0x027e,
  FORMAT: 0x041e,
  XF: 0x00e0,
  BOF: 0x0809,
  RSTRING: 0x00d6,
} as const;

export class BiffError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BiffError";
  }
}

interface BiffRecord {
  id: number;
  data: Buffer;
}

function* records(stream: Buffer): Generator<BiffRecord> {
  let offset = 0;
  while (offset + 4 <= stream.length) {
    const id = stream.readUInt16LE(offset);
    const length = stream.readUInt16LE(offset + 2);
    const start = offset + 4;
    const end = start + length;
    if (end > stream.length) return;
    yield { id, data: stream.subarray(start, end) };
    offset = end;
  }
}

/** XLUnicodeString whose character count is stored in `lengthBytes` bytes. */
function readUnicodeString(data: Buffer, offset: number, lengthBytes: 1 | 2): { text: string; next: number } {
  const charCount = lengthBytes === 1 ? data.readUInt8(offset) : data.readUInt16LE(offset);
  let cursor = offset + lengthBytes;
  const flags = data.readUInt8(cursor);
  cursor += 1;
  const wide = (flags & 0x01) !== 0;
  const rich = (flags & 0x08) !== 0;
  const extended = (flags & 0x04) !== 0;
  let runCount = 0;
  let extendedBytes = 0;
  if (rich) {
    runCount = data.readUInt16LE(cursor);
    cursor += 2;
  }
  if (extended) {
    extendedBytes = data.readUInt32LE(cursor);
    cursor += 4;
  }
  const byteLength = wide ? charCount * 2 : charCount;
  const text = wide
    ? data.subarray(cursor, cursor + byteLength).toString("utf16le")
    : decodeLatin(data.subarray(cursor, cursor + byteLength));
  cursor += byteLength + runCount * 4 + extendedBytes;
  return { text, next: cursor };
}

function decodeLatin(bytes: Buffer): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/**
 * Reads the shared string table. Strings may be split across CONTINUE records,
 * and each continuation restarts with its own compressed/wide flag byte — the
 * classic BIFF8 trap, so the buffer is walked with an explicit cursor rather
 * than record by record.
 */
function readSharedStrings(chunks: Buffer[]): string[] {
  if (chunks.length === 0) return [];
  const boundaries: number[] = [];
  let total = 0;
  for (const chunk of chunks) {
    boundaries.push(total);
    total += chunk.length;
  }
  const buffer = Buffer.concat(chunks);
  const isBoundary = new Set(boundaries.slice(1));

  const uniqueCount = buffer.readUInt32LE(4);
  const strings: string[] = [];
  let cursor = 8;

  for (let index = 0; index < uniqueCount && cursor + 3 <= buffer.length; index += 1) {
    const charCount = buffer.readUInt16LE(cursor);
    cursor += 2;
    let flags = buffer.readUInt8(cursor);
    cursor += 1;
    let wide = (flags & 0x01) !== 0;
    const rich = (flags & 0x08) !== 0;
    const extended = (flags & 0x04) !== 0;
    let runCount = 0;
    let extendedBytes = 0;
    if (rich) {
      runCount = buffer.readUInt16LE(cursor);
      cursor += 2;
    }
    if (extended) {
      extendedBytes = buffer.readUInt32LE(cursor);
      cursor += 4;
    }

    let text = "";
    let remaining = charCount;
    while (remaining > 0 && cursor < buffer.length) {
      const untilBoundary = nextBoundary(isBoundary, cursor, buffer.length) - cursor;
      const availableChars = wide ? Math.floor(untilBoundary / 2) : untilBoundary;
      const take = Math.min(remaining, availableChars);
      const byteLength = wide ? take * 2 : take;
      text += wide
        ? buffer.subarray(cursor, cursor + byteLength).toString("utf16le")
        : decodeLatin(buffer.subarray(cursor, cursor + byteLength));
      cursor += byteLength;
      remaining -= take;
      if (remaining > 0) {
        // Crossed into a CONTINUE payload: it starts with a fresh flag byte.
        flags = buffer.readUInt8(cursor);
        cursor += 1;
        wide = (flags & 0x01) !== 0;
      }
    }
    cursor += runCount * 4 + extendedBytes;
    strings.push(text);
  }
  return strings;
}

function nextBoundary(boundaries: Set<number>, cursor: number, end: number): number {
  for (let position = cursor + 1; position <= end; position += 1) {
    if (boundaries.has(position)) return position;
  }
  return end;
}

function decodeRk(rk: number): number {
  const isInteger = (rk & 0x02) !== 0;
  const divide = (rk & 0x01) !== 0;
  let value: number;
  if (isInteger) {
    value = rk >> 2;
  } else {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(0, 0);
    buffer.writeInt32LE(rk & 0xfffffffc, 4);
    value = buffer.readDoubleLE(0);
  }
  return divide ? value / 100 : value;
}

interface Workbook {
  sheetNames: string[];
  sheetOffsets: number[];
  sharedStrings: string[];
  dateXfs: Set<number>;
}

function readGlobals(stream: Buffer): Workbook {
  const sheetNames: string[] = [];
  const sheetOffsets: number[] = [];
  const sstChunks: Buffer[] = [];
  const customFormats = new Map<number, string>();
  const xfFormats: number[] = [];
  let collectingSst = false;

  for (const record of records(stream)) {
    if (record.id === RECORD.SST) {
      sstChunks.length = 0;
      sstChunks.push(record.data);
      collectingSst = true;
      continue;
    }
    if (record.id === RECORD.CONTINUE && collectingSst) {
      sstChunks.push(record.data);
      continue;
    }
    collectingSst = false;

    if (record.id === RECORD.BOUNDSHEET) {
      sheetOffsets.push(record.data.readUInt32LE(0));
      sheetNames.push(readUnicodeString(record.data, 6, 1).text);
    } else if (record.id === RECORD.FORMAT) {
      customFormats.set(record.data.readUInt16LE(0), readUnicodeString(record.data, 2, 2).text);
    } else if (record.id === RECORD.XF) {
      xfFormats.push(record.data.readUInt16LE(2));
    } else if (record.id === RECORD.EOF) {
      break;
    }
  }

  const dateXfs = new Set<number>();
  xfFormats.forEach((formatId, index) => {
    if (BUILTIN_DATE_FORMAT_IDS.has(formatId)) {
      dateXfs.add(index);
      return;
    }
    const custom = customFormats.get(formatId);
    if (custom && looksLikeDateFormat(custom)) dateXfs.add(index);
  });

  return { sheetNames, sheetOffsets, sharedStrings: readSharedStrings(sstChunks), dateXfs };
}

/** Reads the first worksheet of a BIFF8 workbook into a plain grid. */
export function readXlsSheet(data: Buffer): SheetGrid {
  const file = CompoundFile.parse(data);
  const stream = file.readStream("Workbook") ?? file.readStream("Book");
  if (!stream) throw new BiffError("BIFF_NO_WORKBOOK", "ไม่พบ Workbook stream ในไฟล์ .xls");

  const globals = readGlobals(stream);
  if (globals.sheetOffsets.length === 0) throw new BiffError("BIFF_NO_SHEET", "ไม่พบ worksheet ในไฟล์");

  const sheetStart = globals.sheetOffsets[0];
  if (sheetStart >= stream.length) throw new BiffError("BIFF_SHEET_RANGE", "ตำแหน่ง worksheet ในไฟล์ไม่ถูกต้อง");

  const rows: (string | null)[][] = [];
  const put = (row: number, column: number, value: string | null): void => {
    while (rows.length <= row) rows.push([]);
    const target = rows[row];
    while (target.length <= column) target.push(null);
    target[column] = value;
  };

  const numberCell = (row: number, column: number, xf: number, value: number): void => {
    if (globals.dateXfs.has(xf)) {
      const iso = excelSerialToIsoDate(value);
      put(row, column, iso ?? formatNumber(value));
      return;
    }
    put(row, column, formatNumber(value));
  };

  let pendingStringCell: { row: number; column: number } | null = null;

  for (const record of records(stream.subarray(sheetStart))) {
    switch (record.id) {
      case RECORD.LABELSST: {
        const row = record.data.readUInt16LE(0);
        const column = record.data.readUInt16LE(2);
        const index = record.data.readUInt32LE(6);
        put(row, column, globals.sharedStrings[index] ?? "");
        break;
      }
      case RECORD.LABEL:
      case RECORD.RSTRING: {
        const row = record.data.readUInt16LE(0);
        const column = record.data.readUInt16LE(2);
        put(row, column, readUnicodeString(record.data, 6, 2).text);
        break;
      }
      case RECORD.NUMBER: {
        numberCell(record.data.readUInt16LE(0), record.data.readUInt16LE(2), record.data.readUInt16LE(4), record.data.readDoubleLE(6));
        break;
      }
      case RECORD.RK: {
        numberCell(
          record.data.readUInt16LE(0),
          record.data.readUInt16LE(2),
          record.data.readUInt16LE(4),
          decodeRk(record.data.readUInt32LE(6)),
        );
        break;
      }
      case RECORD.MULRK: {
        const row = record.data.readUInt16LE(0);
        const firstColumn = record.data.readUInt16LE(2);
        const count = Math.floor((record.data.length - 6) / 6);
        for (let index = 0; index < count; index += 1) {
          const base = 4 + index * 6;
          numberCell(row, firstColumn + index, record.data.readUInt16LE(base), decodeRk(record.data.readUInt32LE(base + 2)));
        }
        break;
      }
      case RECORD.BLANK: {
        put(record.data.readUInt16LE(0), record.data.readUInt16LE(2), null);
        break;
      }
      case RECORD.MULBLANK: {
        const row = record.data.readUInt16LE(0);
        const firstColumn = record.data.readUInt16LE(2);
        const count = Math.floor((record.data.length - 6) / 2);
        for (let index = 0; index < count; index += 1) put(row, firstColumn + index, null);
        break;
      }
      case RECORD.FORMULA: {
        const row = record.data.readUInt16LE(0);
        const column = record.data.readUInt16LE(2);
        const xf = record.data.readUInt16LE(4);
        // A cached string result is delivered by the STRING record that follows.
        if (record.data.readUInt16LE(12) === 0xffff && record.data.readUInt8(6) === 0x00) {
          pendingStringCell = { row, column };
        } else if (record.data.readUInt16LE(12) === 0xffff) {
          put(row, column, null);
        } else {
          numberCell(row, column, xf, record.data.readDoubleLE(6));
        }
        break;
      }
      case RECORD.STRING: {
        if (pendingStringCell) {
          put(pendingStringCell.row, pendingStringCell.column, readUnicodeString(record.data, 0, 2).text);
          pendingStringCell = null;
        }
        break;
      }
      case RECORD.EOF:
        return { sheetName: globals.sheetNames[0] ?? "Sheet1", rows };
      default:
        break;
    }
  }

  return { sheetName: globals.sheetNames[0] ?? "Sheet1", rows };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    // Long codes stored as numbers must not come back as "1e+24".
    return Math.abs(value) >= 1e21 ? BigInt(value).toString() : String(value);
  }
  // Excel stores at most 15 significant digits; trim binary noise like 1.4000000000000001.
  return String(Number(value.toPrecision(15)));
}
