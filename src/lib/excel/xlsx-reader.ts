/**
 * `.xlsx` worksheet reader: OOXML is a ZIP of XML, so this needs only the ZIP
 * reader plus a small, deliberately non-generic XML scanner.
 */

import { BUILTIN_DATE_FORMAT_IDS, excelSerialToIsoDate, looksLikeDateFormat } from "./dates";
import type { SheetGrid } from "./sheet";
import { openZip } from "./zip-reader";

export class XlsxError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "XlsxError";
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = entity.startsWith("#x") || entity.startsWith("#X")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
    }
  });
}

/** Concatenates every <t> in each <si>, which is how rich-text runs are joined. */
function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let item: RegExpExecArray | null;
  while ((item = itemPattern.exec(xml)) !== null) {
    const body = item[1] ?? "";
    let text = "";
    let run: RegExpExecArray | null;
    textPattern.lastIndex = 0;
    while ((run = textPattern.exec(body)) !== null) text += decodeEntities(run[1] ?? "");
    strings.push(text);
  }
  return strings;
}

/** Maps each cell style index to whether its number format renders as a date. */
function readDateStyles(xml: string | null): Set<number> {
  const dateStyles = new Set<number>();
  if (!xml) return dateStyles;

  const customDateFormats = new Set<number>();
  const formatPattern = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/?>/g;
  let format: RegExpExecArray | null;
  while ((format = formatPattern.exec(xml)) !== null) {
    if (looksLikeDateFormat(decodeEntities(format[2]))) customDateFormats.add(Number(format[1]));
  }

  const cellXfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cellXfsMatch) return dateStyles;
  const xfPattern = /<xf\b[^>]*\/?>/g;
  let xf: RegExpExecArray | null;
  let index = 0;
  while ((xf = xfPattern.exec(cellXfsMatch[1])) !== null) {
    const idMatch = /numFmtId="(\d+)"/.exec(xf[0]);
    const formatId = idMatch ? Number(idMatch[1]) : 0;
    if (BUILTIN_DATE_FORMAT_IDS.has(formatId) || customDateFormats.has(formatId)) dateStyles.add(index);
    index += 1;
  }
  return dateStyles;
}

/** "BC12" -> 54 (zero-based column index). */
export function columnIndexFromReference(reference: string): number {
  let index = 0;
  for (const character of reference) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

export function readXlsxSheet(data: Buffer): SheetGrid {
  const archive = openZip(data);
  const workbookXml = archive.read("xl/workbook.xml")?.toString("utf8") ?? null;
  if (!workbookXml) throw new XlsxError("XLSX_NO_WORKBOOK", "ไม่พบ xl/workbook.xml ในไฟล์ .xlsx");

  const sheetMatch = /<sheet\b[^>]*name="([^"]*)"[^>]*\/?>/.exec(workbookXml);
  const sheetName = sheetMatch ? decodeEntities(sheetMatch[1]) : "Sheet1";

  const relationships = archive.read("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationshipId = sheetMatch ? /r:id="([^"]*)"/.exec(sheetMatch[0])?.[1] : undefined;
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (relationshipId) {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${relationshipId}"[^>]*Target="([^"]*)"`).exec(relationships)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }

  const sheetXml = (archive.read(sheetPath) ?? archive.read("xl/worksheets/sheet1.xml"))?.toString("utf8");
  if (!sheetXml) throw new XlsxError("XLSX_NO_SHEET", "ไม่พบ worksheet แรกในไฟล์ .xlsx");

  const sharedStrings = readSharedStrings(archive.read("xl/sharedStrings.xml")?.toString("utf8") ?? null);
  const dateStyles = readDateStyles(archive.read("xl/styles.xml")?.toString("utf8") ?? null);

  const rows: (string | null)[][] = [];
  const put = (row: number, column: number, value: string | null): void => {
    while (rows.length <= row) rows.push([]);
    const target = rows[row];
    while (target.length <= column) target.push(null);
    target[column] = value;
  };

  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowMatch: RegExpExecArray | null;
  let fallbackRow = 0;

  while ((rowMatch = rowPattern.exec(sheetXml)) !== null) {
    const attributes = rowMatch[1] ?? "";
    const body = rowMatch[2] ?? "";
    const declaredRow = /\br="(\d+)"/.exec(attributes)?.[1];
    const rowIndex = declaredRow ? Number(declaredRow) - 1 : fallbackRow;
    fallbackRow = rowIndex + 1;

    let cellMatch: RegExpExecArray | null;
    let fallbackColumn = 0;
    cellPattern.lastIndex = 0;
    while ((cellMatch = cellPattern.exec(body)) !== null) {
      const cellAttributes = cellMatch[1] ?? "";
      const cellBody = cellMatch[2] ?? "";
      const reference = /\br="([A-Z]+)\d+"/.exec(cellAttributes)?.[1];
      const columnIndex = reference ? columnIndexFromReference(reference) : fallbackColumn;
      fallbackColumn = columnIndex + 1;

      const type = /\bt="([^"]*)"/.exec(cellAttributes)?.[1] ?? "n";
      const styleIndex = Number(/\bs="(\d+)"/.exec(cellAttributes)?.[1] ?? "-1");

      if (type === "inlineStr") {
        let text = "";
        const inlinePattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let run: RegExpExecArray | null;
        while ((run = inlinePattern.exec(cellBody)) !== null) text += decodeEntities(run[1]);
        put(rowIndex, columnIndex, text);
        continue;
      }

      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellBody)?.[1];
      if (raw === undefined) {
        put(rowIndex, columnIndex, null);
        continue;
      }
      const value = decodeEntities(raw);

      if (type === "s") {
        put(rowIndex, columnIndex, sharedStrings[Number(value)] ?? "");
      } else if (type === "str" || type === "e") {
        put(rowIndex, columnIndex, value);
      } else if (type === "b") {
        put(rowIndex, columnIndex, value === "1" ? "TRUE" : "FALSE");
      } else {
        const numeric = Number(value);
        if (dateStyles.has(styleIndex) && Number.isFinite(numeric)) {
          put(rowIndex, columnIndex, excelSerialToIsoDate(numeric) ?? value);
        } else {
          put(rowIndex, columnIndex, value);
        }
      }
    }
  }

  return { sheetName, rows };
}
