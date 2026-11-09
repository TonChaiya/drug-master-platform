import { readFirstSheet } from "@/lib/excel/workbook";
import { cellText } from "@/lib/excel/sheet";
import { normalizeRegistrationNumber, normalizeSearchText } from "./normalize";

const COLUMN_ALIASES: Record<string, string[]> = {
  code: ["ttmtcode", "tpucode", "code", "ttmtid", "รหัส"],
  activeIngredient: ["activeingredient", "genericname", "generic", "ชื่อสามัญ"],
  strength: ["strength", "ความแรง"], dosageForm: ["dosageform", "รูปแบบ"],
  contentValue: ["contvalue", "content"], contentUnit: ["contunit"],
  dispensingUnit: ["dispunit", "unit", "หน่วย"], tradeName: ["tradename", "ชื่อการค้า"],
  manufacturer: ["manufacturer", "ผู้ผลิต"], fsn: ["fsn"], status: ["status", "สถานะ"],
  nlem: ["nlem", "ed", "ised"], registrationNumber: ["regno", "registrationnumber", "เลขทะเบียน"],
};

export class TtmtImportError extends Error {
  constructor(readonly code: string, message: string, readonly details?: readonly string[]) {
    super(message);
    this.name = "TtmtImportError";
  }
}

export interface ParsedTtmtProduct {
  ttmtcode: string;
  activeingredient: string | null;
  strength: string | null;
  dosageform: string | null;
  contvalue: string | null;
  contunit: string | null;
  dispunit: string | null;
  tradename: string | null;
  manufacturer: string | null;
  fsn: string | null;
  status: "active" | "inactive";
  nlem: string | null;
  registrationNumber: string | null;
  normalizedGeneric: string | null;
  normalizedTrade: string | null;
  normalizedManufacturer: string | null;
  normalizedRegno: string | null;
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.-]/g, "");
}

export function parseMasterTtmt(
  data: Buffer,
  options: { duplicatePolicy: "first" | "reject" },
): { products: ParsedTtmtProduct[]; warnings: string[] } {
  const sheet = readFirstSheet(data);
  const headerRow = sheet.rows[0] ?? [];
  const columnByField = new Map<string, number>();
  headerRow.forEach((header, index) => {
    const key = headerKey(header ?? "");
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (!columnByField.has(field) && aliases.includes(key)) columnByField.set(field, index);
    }
  });
  const codeColumn = columnByField.get("code");
  if (codeColumn === undefined) {
    throw new TtmtImportError("TTMT_HEADER_MISSING", "ไม่พบคอลัมน์รหัส TTMT ในไฟล์", [`หัวตารางที่พบ: ${headerRow.filter(Boolean).join(", ").slice(0, 500)}`]);
  }
  const field = (rowIndex: number, name: string): string | null => {
    const column = columnByField.get(name);
    if (column === undefined) return null;
    const value = cellText(sheet, rowIndex, column);
    return value === "" ? null : value;
  };

  const warnings: string[] = [];
  const seen = new Set<string>();
  const products: ParsedTtmtProduct[] = [];
  for (let rowIndex = 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const code = cellText(sheet, rowIndex, codeColumn);
    if (code === "") continue;
    if (options.duplicatePolicy === "reject" && code.length > 64) {
      throw new TtmtImportError("TTMT_CODE_INVALID", `รหัส TTMT ยาวเกิน 64 ตัวอักษรที่แถว ${rowIndex + 1}`);
    }
    if (seen.has(code)) {
      if (options.duplicatePolicy === "reject") throw new TtmtImportError("TTMT_DUPLICATE_CODE", `รหัส TTMT ${code} ซ้ำในไฟล์`);
      if (warnings.length < 50) warnings.push(`รหัส ${code} ซ้ำในไฟล์ ใช้ค่าที่พบครั้งแรก`);
      continue;
    }
    seen.add(code);
    const activeIngredient = field(rowIndex, "activeIngredient");
    const tradeName = field(rowIndex, "tradeName");
    const manufacturer = field(rowIndex, "manufacturer");
    const registrationNumber = field(rowIndex, "registrationNumber");
    const status = (field(rowIndex, "status") ?? "0").trim().toLowerCase();
    products.push({
      ttmtcode: code.slice(0, 64), activeingredient: activeIngredient,
      strength: field(rowIndex, "strength"), dosageform: field(rowIndex, "dosageForm"),
      contvalue: field(rowIndex, "contentValue"), contunit: field(rowIndex, "contentUnit"),
      dispunit: field(rowIndex, "dispensingUnit"), tradename: tradeName, manufacturer,
      fsn: field(rowIndex, "fsn"), status: status === "0" || status === "active" ? "active" : "inactive",
      nlem: field(rowIndex, "nlem"), registrationNumber,
      normalizedGeneric: normalizeSearchText(activeIngredient), normalizedTrade: normalizeSearchText(tradeName),
      normalizedManufacturer: normalizeSearchText(manufacturer), normalizedRegno: normalizeRegistrationNumber(registrationNumber),
    });
  }
  if (products.length === 0) throw new TtmtImportError("TTMT_EMPTY", "ไฟล์นี้ไม่มีแถวข้อมูล TTMT");
  return { products, warnings };
}
