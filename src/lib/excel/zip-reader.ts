/**
 * Minimal ZIP reader for `.xlsx` files. Uses Node's built-in zlib, so no
 * third-party dependency is needed. Only stored (0) and deflate (8) entries are
 * supported, which is everything Excel and LibreOffice produce.
 */

import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP64_END_LOCATOR = 0x07064b50;
const MAX_COMMENT = 0xffff;

export class ZipError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipArchive {
  names: string[];
  read(name: string): Buffer | null;
}

export function isZip(data: Buffer): boolean {
  return data.length >= 4 && data.readUInt32LE(0) === 0x04034b50;
}

export function openZip(data: Buffer): ZipArchive {
  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new ZipError("ZIP_NO_EOCD", "ไม่พบโครงสร้าง ZIP ที่ถูกต้อง (ไฟล์ .xlsx เสียหาย)");
  if (data.length >= 20 && findZip64Locator(data, eocd)) {
    throw new ZipError("ZIP_ZIP64", "ไฟล์ .xlsx ใช้รูปแบบ ZIP64 ซึ่งยังไม่รองรับ");
  }

  const entryCount = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const entries = new Map<string, { offset: number; method: number; compressedSize: number; uncompressedSize: number }>();

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new ZipError("ZIP_CENTRAL_DIRECTORY", "central directory ของไฟล์ ZIP ไม่ถูกต้อง");
    }
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.set(name, { offset: localOffset, method, compressedSize, uncompressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return {
    names: [...entries.keys()],
    read(name: string): Buffer | null {
      const entry = entries.get(name);
      if (!entry) return null;
      const local = entry.offset;
      if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) {
        throw new ZipError("ZIP_LOCAL_HEADER", "local header ของไฟล์ใน ZIP ไม่ถูกต้อง");
      }
      const nameLength = data.readUInt16LE(local + 26);
      const extraLength = data.readUInt16LE(local + 28);
      const start = local + 30 + nameLength + extraLength;
      const raw = data.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return Buffer.from(raw);
      if (entry.method !== 8) throw new ZipError("ZIP_METHOD", "วิธีบีบอัดในไฟล์ ZIP ไม่รองรับ");
      const inflated = inflateRawSync(raw);
      if (entry.uncompressedSize && inflated.length !== entry.uncompressedSize) {
        throw new ZipError("ZIP_SIZE_MISMATCH", "ขนาดข้อมูลหลังคลายบีบอัดไม่ตรงกับที่ระบุไว้");
      }
      return inflated;
    },
  };
}

function findEndOfCentralDirectory(data: Buffer): number {
  const start = Math.max(0, data.length - MAX_COMMENT - 22);
  for (let offset = data.length - 22; offset >= start; offset -= 1) {
    if (data.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

function findZip64Locator(data: Buffer, eocd: number): boolean {
  const candidate = eocd - 20;
  return candidate >= 0 && data.readUInt32LE(candidate) === ZIP64_END_LOCATOR;
}
