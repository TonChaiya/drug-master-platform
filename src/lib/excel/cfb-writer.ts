/**
 * Writes a single-stream OLE2 / Compound File Binary container — the wrapper a
 * BIFF8 `.xls` lives inside.
 */

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const ENTRIES_PER_FAT_SECTOR = SECTOR_SIZE / 4;

const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const MAX_HEADER_DIFAT = 109;

export class CfbWriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CfbWriteError";
  }
}

function padToMultiple(data: Buffer, multiple: number): Buffer {
  const remainder = data.length % multiple;
  if (remainder === 0) return data;
  return Buffer.concat([data, Buffer.alloc(multiple - remainder)]);
}

function writeDirectoryEntry(
  target: Buffer,
  index: number,
  options: {
    name: string;
    objectType: number;
    child?: number;
    startSector: number;
    streamSize: number;
  },
): void {
  const base = index * 128;
  const nameBuffer = Buffer.from(`${options.name}\0`, "utf16le");
  if (nameBuffer.length > 64) throw new CfbWriteError("CFB_NAME_TOO_LONG", "ชื่อ stream ยาวเกินกำหนด");
  nameBuffer.copy(target, base);
  target.writeUInt16LE(nameBuffer.length, base + 0x40);
  target.writeUInt8(options.objectType, base + 0x42);
  target.writeUInt8(1, base + 0x43); // black
  target.writeUInt32LE(FREE, base + 0x44); // left sibling
  target.writeUInt32LE(FREE, base + 0x48); // right sibling
  target.writeUInt32LE(options.child ?? FREE, base + 0x4c);
  target.writeUInt32LE(options.startSector, base + 0x74);
  target.writeUInt32LE(options.streamSize, base + 0x78);
  target.writeUInt32LE(0, base + 0x7c);
}

/**
 * Packs `streamData` into a compound file under `streamName`.
 *
 * Streams below the 4 KiB cutoff must live in the mini stream, so both storage
 * paths are implemented: a reader decides where to look purely from the recorded
 * stream size, and getting this wrong yields a file that opens empty.
 */
export function buildCompoundFile(streamName: string, streamData: Buffer): Buffer {
  const useMiniStream = streamData.length < MINI_STREAM_CUTOFF;

  let dataSectorCount: number;
  let miniStreamSectorCount = 0;
  let miniFatSectorCount = 0;
  let miniSectorCount = 0;
  let miniStreamPadded: Buffer = Buffer.alloc(0);
  let mainPadded: Buffer = Buffer.alloc(0);

  if (useMiniStream) {
    miniSectorCount = Math.ceil(streamData.length / MINI_SECTOR_SIZE);
    miniStreamPadded = padToMultiple(streamData, MINI_SECTOR_SIZE);
    miniStreamSectorCount = Math.ceil(miniStreamPadded.length / SECTOR_SIZE) || 1;
    miniStreamPadded = padToMultiple(miniStreamPadded, SECTOR_SIZE);
    miniFatSectorCount = Math.max(1, Math.ceil((miniSectorCount * 4) / SECTOR_SIZE));
    dataSectorCount = 0;
  } else {
    mainPadded = padToMultiple(streamData, SECTOR_SIZE);
    dataSectorCount = mainPadded.length / SECTOR_SIZE;
  }

  const directorySectorCount = 1;
  const nonFatSectorCount = dataSectorCount + miniStreamSectorCount + miniFatSectorCount + directorySectorCount;

  // The FAT must describe itself, so grow it until it covers every sector.
  let fatSectorCount = 1;
  while (nonFatSectorCount + fatSectorCount > fatSectorCount * ENTRIES_PER_FAT_SECTOR) fatSectorCount += 1;
  if (fatSectorCount > MAX_HEADER_DIFAT) {
    throw new CfbWriteError("CFB_TOO_LARGE", "ไฟล์ใหญ่เกินกว่าที่ตัวเขียน .xls นี้รองรับ");
  }

  // Sector layout: [stream data][mini stream][mini FAT][directory][FAT]
  const dataStart = 0;
  const miniStreamStart = dataStart + dataSectorCount;
  const miniFatStart = miniStreamStart + miniStreamSectorCount;
  const directoryStart = miniFatStart + miniFatSectorCount;
  const fatStart = directoryStart + directorySectorCount;
  const totalSectors = fatStart + fatSectorCount;

  const fat = new Uint32Array(fatSectorCount * ENTRIES_PER_FAT_SECTOR).fill(FREE);
  const chain = (start: number, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      fat[start + index] = index === count - 1 ? END_OF_CHAIN : start + index + 1;
    }
  };
  chain(dataStart, dataSectorCount);
  chain(miniStreamStart, miniStreamSectorCount);
  chain(miniFatStart, miniFatSectorCount);
  chain(directoryStart, directorySectorCount);
  for (let index = 0; index < fatSectorCount; index += 1) fat[fatStart + index] = FAT_SECTOR;

  const miniFat = new Uint32Array(miniFatSectorCount * ENTRIES_PER_FAT_SECTOR).fill(FREE);
  for (let index = 0; index < miniSectorCount; index += 1) {
    miniFat[index] = index === miniSectorCount - 1 ? END_OF_CHAIN : index + 1;
  }

  const directory = Buffer.alloc(SECTOR_SIZE);
  for (let index = 0; index < 4; index += 1) {
    directory.writeUInt32LE(FREE, index * 128 + 0x44);
    directory.writeUInt32LE(FREE, index * 128 + 0x48);
    directory.writeUInt32LE(FREE, index * 128 + 0x4c);
  }
  writeDirectoryEntry(directory, 0, {
    name: "Root Entry",
    objectType: 5,
    child: 1,
    startSector: useMiniStream ? miniStreamStart : END_OF_CHAIN,
    streamSize: useMiniStream ? miniSectorCount * MINI_SECTOR_SIZE : 0,
  });
  writeDirectoryEntry(directory, 1, {
    name: streamName,
    objectType: 2,
    startSector: useMiniStream ? 0 : dataStart,
    streamSize: streamData.length,
  });

  const header = Buffer.alloc(SECTOR_SIZE);
  SIGNATURE.copy(header, 0);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(0x0003, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(0, 0x28);
  header.writeUInt32LE(fatSectorCount, 0x2c);
  header.writeUInt32LE(directoryStart, 0x30);
  header.writeUInt32LE(0, 0x34);
  header.writeUInt32LE(MINI_STREAM_CUTOFF, 0x38);
  header.writeUInt32LE(miniFatSectorCount > 0 ? miniFatStart : END_OF_CHAIN, 0x3c);
  header.writeUInt32LE(miniFatSectorCount, 0x40);
  header.writeUInt32LE(END_OF_CHAIN, 0x44);
  header.writeUInt32LE(0, 0x48);
  for (let index = 0; index < MAX_HEADER_DIFAT; index += 1) {
    header.writeUInt32LE(index < fatSectorCount ? fatStart + index : FREE, 0x4c + index * 4);
  }

  const body = Buffer.alloc(totalSectors * SECTOR_SIZE);
  if (!useMiniStream) mainPadded.copy(body, dataStart * SECTOR_SIZE);
  if (useMiniStream) miniStreamPadded.copy(body, miniStreamStart * SECTOR_SIZE);
  for (let index = 0; index < miniFat.length; index += 1) {
    body.writeUInt32LE(miniFat[index], miniFatStart * SECTOR_SIZE + index * 4);
  }
  directory.copy(body, directoryStart * SECTOR_SIZE);
  for (let index = 0; index < fat.length; index += 1) {
    body.writeUInt32LE(fat[index], fatStart * SECTOR_SIZE + index * 4);
  }

  return Buffer.concat([header, body]);
}
