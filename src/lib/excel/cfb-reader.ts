/**
 * Minimal OLE2 / Compound File Binary reader — enough to pull the `Workbook`
 * stream out of a BIFF8 `.xls` file.
 *
 * Written by hand rather than pulled from npm on purpose: docs/SPEC.md
 * makes the `.xls` contract a locked, testable requirement, and a hand-rolled
 * reader we fully control is easier to pin down than a general-purpose library.
 */

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const DIFAT_SECTOR = 0xfffffffc;
const MAX_SECTOR_HOPS = 1 << 22;

export interface CfbEntry {
  name: string;
  objectType: number;
  startSector: number;
  streamSize: number;
}

export class CfbError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CfbError";
  }
}

export class CompoundFile {
  private constructor(
    private readonly data: Buffer,
    private readonly sectorSize: number,
    private readonly miniSectorSize: number,
    private readonly miniStreamCutoff: number,
    private readonly fat: Uint32Array,
    private readonly miniFat: Uint32Array,
    private readonly miniStream: Buffer,
    readonly entries: CfbEntry[],
  ) {}

  static isCompoundFile(data: Buffer): boolean {
    return data.length >= 8 && data.subarray(0, 8).equals(SIGNATURE);
  }

  static parse(data: Buffer): CompoundFile {
    if (!CompoundFile.isCompoundFile(data)) throw new CfbError("CFB_SIGNATURE", "ไม่ใช่ไฟล์ .xls (OLE2) ที่ถูกต้อง");
    if (data.length < 512) throw new CfbError("CFB_TRUNCATED", "ไฟล์สั้นเกินกว่าจะเป็น .xls ที่สมบูรณ์");

    const sectorShift = data.readUInt16LE(0x1e);
    const miniSectorShift = data.readUInt16LE(0x20);
    if (sectorShift !== 9 && sectorShift !== 12) throw new CfbError("CFB_SECTOR_SHIFT", "ขนาด sector ของไฟล์ไม่รองรับ");
    if (miniSectorShift !== 6) throw new CfbError("CFB_MINI_SHIFT", "ขนาด mini sector ของไฟล์ไม่รองรับ");

    const sectorSize = 1 << sectorShift;
    const miniSectorSize = 1 << miniSectorShift;
    const fatSectorCount = data.readUInt32LE(0x2c);
    const firstDirectorySector = data.readUInt32LE(0x30);
    const miniStreamCutoff = data.readUInt32LE(0x38);
    const firstMiniFatSector = data.readUInt32LE(0x3c);
    const miniFatSectorCount = data.readUInt32LE(0x40);
    const firstDifatSector = data.readUInt32LE(0x44);
    const difatSectorCount = data.readUInt32LE(0x48);

    const sectorOffset = (sector: number): number => 512 + sector * sectorSize;
    const readSector = (sector: number): Buffer => {
      const start = sectorOffset(sector);
      if (start < 0 || start + sectorSize > data.length) throw new CfbError("CFB_SECTOR_RANGE", "ไฟล์อ้างถึง sector ที่อยู่นอกขอบเขต");
      return data.subarray(start, start + sectorSize);
    };

    // --- DIFAT: the list of sectors that hold the FAT itself.
    const difat: number[] = [];
    for (let index = 0; index < 109; index += 1) {
      const sector = data.readUInt32LE(0x4c + index * 4);
      if (sector === FREE_SECTOR) break;
      difat.push(sector);
    }
    let difatSector = firstDifatSector;
    const entriesPerDifat = sectorSize / 4 - 1;
    for (let visited = 0; difatSector !== END_OF_CHAIN && difatSector !== FREE_SECTOR && visited <= difatSectorCount + 1; visited += 1) {
      const chunk = readSector(difatSector);
      for (let index = 0; index < entriesPerDifat; index += 1) {
        const sector = chunk.readUInt32LE(index * 4);
        if (sector === FREE_SECTOR || sector === END_OF_CHAIN) continue;
        difat.push(sector);
      }
      difatSector = chunk.readUInt32LE(entriesPerDifat * 4);
    }
    if (difat.length < fatSectorCount) throw new CfbError("CFB_DIFAT", "โครงสร้าง DIFAT ของไฟล์ไม่สมบูรณ์");

    // --- FAT: next-sector table for the whole file.
    const entriesPerSector = sectorSize / 4;
    const fat = new Uint32Array(fatSectorCount * entriesPerSector);
    for (let index = 0; index < fatSectorCount; index += 1) {
      const chunk = readSector(difat[index]);
      for (let slot = 0; slot < entriesPerSector; slot += 1) {
        fat[index * entriesPerSector + slot] = chunk.readUInt32LE(slot * 4);
      }
    }

    const followChain = (start: number, limitBytes: number, table: Uint32Array, read: (sector: number) => Buffer): Buffer => {
      const parts: Buffer[] = [];
      let sector = start;
      let hops = 0;
      let total = 0;
      while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && sector !== DIFAT_SECTOR) {
        if (hops > MAX_SECTOR_HOPS) throw new CfbError("CFB_CHAIN_LOOP", "โครงสร้างไฟล์วนซ้ำ");
        if (sector >= table.length) throw new CfbError("CFB_CHAIN_RANGE", "ไฟล์อ้างถึง sector ที่ไม่มีอยู่");
        parts.push(read(sector));
        total += parts[parts.length - 1].length;
        if (limitBytes >= 0 && total >= limitBytes) break;
        sector = table[sector];
        hops += 1;
      }
      const joined = Buffer.concat(parts);
      return limitBytes >= 0 ? joined.subarray(0, limitBytes) : joined;
    };

    // --- Directory entries.
    const directory = followChain(firstDirectorySector, -1, fat, readSector);
    const entries: CfbEntry[] = [];
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const nameLength = directory.readUInt16LE(offset + 0x40);
      const objectType = directory.readUInt8(offset + 0x42);
      if (objectType === 0) continue;
      const nameBytes = Math.max(0, Math.min(64, nameLength) - 2);
      entries.push({
        name: directory.subarray(offset, offset + nameBytes).toString("utf16le"),
        objectType,
        startSector: directory.readUInt32LE(offset + 0x74),
        // Sizes above 4 GiB are not reachable for this format; read the low word.
        streamSize: directory.readUInt32LE(offset + 0x78),
      });
    }

    const root = entries.find((entry) => entry.objectType === 5);
    if (!root) throw new CfbError("CFB_NO_ROOT", "ไม่พบ root directory ในไฟล์");

    // --- Mini FAT and the mini stream that small streams live inside.
    const miniFatRaw = miniFatSectorCount > 0 ? followChain(firstMiniFatSector, -1, fat, readSector) : Buffer.alloc(0);
    const miniFat = new Uint32Array(miniFatRaw.length / 4);
    for (let index = 0; index < miniFat.length; index += 1) miniFat[index] = miniFatRaw.readUInt32LE(index * 4);
    const miniStream = root.streamSize > 0 ? followChain(root.startSector, root.streamSize, fat, readSector) : Buffer.alloc(0);

    return new CompoundFile(data, sectorSize, miniSectorSize, miniStreamCutoff, fat, miniFat, miniStream, entries);
  }

  /** Returns the contents of a named stream, or null when it is absent. */
  readStream(name: string): Buffer | null {
    const entry = this.entries.find((candidate) => candidate.objectType === 2 && candidate.name === name);
    if (!entry) return null;
    if (entry.streamSize === 0) return Buffer.alloc(0);

    if (entry.streamSize < this.miniStreamCutoff) {
      return this.follow(entry.startSector, entry.streamSize, this.miniFat, (sector) => {
        const start = sector * this.miniSectorSize;
        return this.miniStream.subarray(start, start + this.miniSectorSize);
      });
    }
    return this.follow(entry.startSector, entry.streamSize, this.fat, (sector) => {
      const start = 512 + sector * this.sectorSize;
      return this.data.subarray(start, start + this.sectorSize);
    });
  }

  private follow(start: number, limitBytes: number, table: Uint32Array, read: (sector: number) => Buffer): Buffer {
    const parts: Buffer[] = [];
    let sector = start;
    let total = 0;
    let hops = 0;
    while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && total < limitBytes) {
      if (hops > MAX_SECTOR_HOPS) throw new CfbError("CFB_CHAIN_LOOP", "โครงสร้างไฟล์วนซ้ำ");
      if (sector >= table.length) throw new CfbError("CFB_CHAIN_RANGE", "ไฟล์อ้างถึง sector ที่ไม่มีอยู่");
      const chunk = read(sector);
      parts.push(chunk);
      total += chunk.length;
      sector = table[sector];
      hops += 1;
    }
    return Buffer.concat(parts).subarray(0, limitBytes);
  }
}
