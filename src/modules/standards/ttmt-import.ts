import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, standardImports, standardProducts } from "@/db/schema";
import { readFirstSheet } from "@/lib/excel/workbook";
import { cellText } from "@/lib/excel/sheet";
import { normalizeNlem } from "@/modules/mappings/ised";
import { normalizeRegistrationNumber, normalizeSearchText } from "./normalize";

const UPSERT_CHUNK = 500;

/**
 * MasterTTMT arrives as an approved file, not from the TMT API: the API manual
 * does not document a TTMT endpoint, so TTMT keeps its own version and import
 * history and must never be treated as the same dataset as TMT
 * (docs/SPEC.md).
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  code: ["ttmtcode", "tpucode", "code", "ttmtid", "รหัส"],
  activeIngredient: ["activeingredient", "genericname", "generic", "ชื่อสามัญ"],
  strength: ["strength", "ความแรง"],
  dosageForm: ["dosageform", "รูปแบบ"],
  contentValue: ["contvalue", "content"],
  contentUnit: ["contunit"],
  dispensingUnit: ["dispunit", "unit", "หน่วย"],
  tradeName: ["tradename", "ชื่อการค้า"],
  manufacturer: ["manufacturer", "ผู้ผลิต"],
  fsn: ["fsn"],
  status: ["status", "สถานะ"],
  nlem: ["nlem", "ed", "ised"],
  registrationNumber: ["regno", "registrationnumber", "เลขทะเบียน"],
};

export class TtmtImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: readonly string[],
  ) {
    super(message);
    this.name = "TtmtImportError";
  }
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.-]/g, "");
}

export interface TtmtImportResult {
  importId: string;
  version: string;
  rowCount: number;
  warnings: string[];
}

export async function importMasterTtmt(options: {
  userId: string;
  filename: string;
  version: string;
  data: Buffer;
}): Promise<TtmtImportResult> {
  const version = options.version.trim();
  if (!version) throw new TtmtImportError("TTMT_VERSION_REQUIRED", "ต้องระบุเวอร์ชันของไฟล์ MasterTTMT");

  const contentHash = createHash("sha256").update(options.data).digest("hex");
  const duplicate = await db
    .select({ id: standardImports.id })
    .from(standardImports)
    .where(and(eq(standardImports.kind, "TTMT"), eq(standardImports.version, version)))
    .limit(1);
  if (duplicate[0]) throw new TtmtImportError("TTMT_VERSION_EXISTS", `เวอร์ชัน ${version} ถูกนำเข้าไว้แล้ว`);

  const sheet = readFirstSheet(options.data);
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
    throw new TtmtImportError(
      "TTMT_HEADER_MISSING",
      "ไม่พบคอลัมน์รหัส TTMT ในไฟล์",
      [`หัวตารางที่พบ: ${headerRow.filter(Boolean).join(", ").slice(0, 500)}`],
    );
  }

  const field = (rowIndex: number, name: string): string | null => {
    const column = columnByField.get(name);
    if (column === undefined) return null;
    const value = cellText(sheet, rowIndex, column);
    return value === "" ? null : value;
  };

  const warnings: string[] = [];
  const seen = new Set<string>();
  const values: (typeof standardProducts.$inferInsert)[] = [];

  for (let rowIndex = 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const code = cellText(sheet, rowIndex, codeColumn);
    if (code === "") continue;
    if (seen.has(code)) {
      if (warnings.length < 50) warnings.push(`รหัส ${code} ซ้ำในไฟล์ ใช้ค่าที่พบครั้งแรก`);
      continue;
    }
    seen.add(code);

    const ised = normalizeNlem(field(rowIndex, "nlem"));
    if (ised.warning && warnings.length < 50) warnings.push(`${code}: ${ised.warning}`);

    const statusValue = (field(rowIndex, "status") ?? "0").trim();
    const registrationNumber = field(rowIndex, "registrationNumber");
    const activeIngredient = field(rowIndex, "activeIngredient");
    const tradeName = field(rowIndex, "tradeName");
    const manufacturer = field(rowIndex, "manufacturer");

    values.push({
      id: randomUUID(),
      standardCode: code.slice(0, 64),
      standardType: "TTMT",
      activeIngredient,
      strength: field(rowIndex, "strength"),
      dosageForm: field(rowIndex, "dosageForm"),
      contentValue: field(rowIndex, "contentValue"),
      contentUnit: field(rowIndex, "contentUnit"),
      dispensingUnit: field(rowIndex, "dispensingUnit"),
      tradeName,
      manufacturer,
      fsn: field(rowIndex, "fsn"),
      status: statusValue === "0" || statusValue.toLowerCase() === "active" ? "active" : "inactive",
      rawNlem: ised.raw,
      exportIsed: ised.exportValue,
      registrationNumber,
      sourceVersion: version,
      normalizedGeneric: normalizeSearchText(activeIngredient),
      normalizedTrade: normalizeSearchText(tradeName),
      normalizedManufacturer: normalizeSearchText(manufacturer),
      normalizedRegno: normalizeRegistrationNumber(registrationNumber),
    });
  }

  if (values.length === 0) throw new TtmtImportError("TTMT_EMPTY", "ไฟล์นี้ไม่มีแถวข้อมูล TTMT");

  const importId = randomUUID();
  await db.insert(standardImports).values({
    id: importId,
    kind: "TTMT",
    version,
    contentHash,
    rowCount: values.length,
    status: "running",
    importedBy: options.userId,
    startedAt: new Date(),
  });

  try {
    for (let start = 0; start < values.length; start += UPSERT_CHUNK) {
      await db
        .insert(standardProducts)
        .values(values.slice(start, start + UPSERT_CHUNK))
        .onDuplicateKeyUpdate({
          set: {
            standardType: sql`values(${standardProducts.standardType})`,
            activeIngredient: sql`values(${standardProducts.activeIngredient})`,
            strength: sql`values(${standardProducts.strength})`,
            dosageForm: sql`values(${standardProducts.dosageForm})`,
            contentValue: sql`values(${standardProducts.contentValue})`,
            contentUnit: sql`values(${standardProducts.contentUnit})`,
            dispensingUnit: sql`values(${standardProducts.dispensingUnit})`,
            tradeName: sql`values(${standardProducts.tradeName})`,
            manufacturer: sql`values(${standardProducts.manufacturer})`,
            fsn: sql`values(${standardProducts.fsn})`,
            status: sql`values(${standardProducts.status})`,
            rawNlem: sql`values(${standardProducts.rawNlem})`,
            exportIsed: sql`values(${standardProducts.exportIsed})`,
            registrationNumber: sql`values(${standardProducts.registrationNumber})`,
            sourceVersion: sql`values(${standardProducts.sourceVersion})`,
            normalizedGeneric: sql`values(${standardProducts.normalizedGeneric})`,
            normalizedTrade: sql`values(${standardProducts.normalizedTrade})`,
            normalizedManufacturer: sql`values(${standardProducts.normalizedManufacturer})`,
            normalizedRegno: sql`values(${standardProducts.normalizedRegno})`,
            updatedAt: sql`CURRENT_TIMESTAMP(3)`,
          },
        });
    }

    await db.update(standardImports).set({ status: "succeeded", completedAt: new Date() }).where(eq(standardImports.id, importId));
    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.userId,
      action: "standards.ttmt_imported",
      entityType: "standard_import",
      entityId: importId,
      afterJson: { version, filename: options.filename, rowCount: values.length, contentHash },
    });

    return { importId, version, rowCount: values.length, warnings };
  } catch (error) {
    await db.update(standardImports).set({ status: "failed", completedAt: new Date() }).where(eq(standardImports.id, importId));
    throw error;
  }
}

export async function listStandardImports(limit = 20) {
  return db.select().from(standardImports).orderBy(desc(standardImports.startedAt)).limit(limit);
}
