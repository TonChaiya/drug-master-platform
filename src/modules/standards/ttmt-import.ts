import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, standardImports, standardProducts } from "@/db/schema";
import { normalizeNlem } from "@/modules/mappings/ised";
import { parseMasterTtmt, TtmtImportError } from "./ttmt-parser";

export { TtmtImportError } from "./ttmt-parser";

const UPSERT_CHUNK = 500;

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

  const parsed = parseMasterTtmt(options.data, { duplicatePolicy: "first" });
  const warnings = [...parsed.warnings];
  const values: (typeof standardProducts.$inferInsert)[] = parsed.products.map((product) => {
    const ised = normalizeNlem(product.nlem);
    if (ised.warning && warnings.length < 50) warnings.push(`${product.ttmtcode}: ${ised.warning}`);
    return {
      id: randomUUID(),
      standardCode: product.ttmtcode,
      standardType: "TTMT",
      activeIngredient: product.activeingredient,
      strength: product.strength,
      dosageForm: product.dosageform,
      contentValue: product.contvalue,
      contentUnit: product.contunit,
      dispensingUnit: product.dispunit,
      tradeName: product.tradename,
      manufacturer: product.manufacturer,
      fsn: product.fsn,
      status: product.status,
      rawNlem: ised.raw,
      exportIsed: ised.exportValue,
      registrationNumber: product.registrationNumber,
      sourceVersion: version,
      normalizedGeneric: product.normalizedGeneric,
      normalizedTrade: product.normalizedTrade,
      normalizedManufacturer: product.normalizedManufacturer,
      normalizedRegno: product.normalizedRegno,
    };
  });

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
