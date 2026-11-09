import { createHash, randomUUID } from "node:crypto";
import { or, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "@/db/schema";
import { auditLogs, ttmtImports, ttmtProducts } from "@/db/schema";
import { parseMasterTtmt, TtmtImportError, type ParsedTtmtProduct } from "./ttmt-parser";

const UPSERT_CHUNK = 500;

export interface TtmtV2ImportCommit {
  importId: string;
  filename: string;
  version: string;
  contentHash: string;
  importedBy: string;
  startedAt: Date;
  products: ParsedTtmtProduct[];
}

export interface TtmtV2ImportStore {
  commit(input: TtmtV2ImportCommit): Promise<void>;
}

function createStore(database: typeof db): TtmtV2ImportStore { return {
  async commit(input) {
    await database.transaction(async (tx) => {
      const duplicate = await tx.select({ id: ttmtImports.id, version: ttmtImports.version, contentHash: ttmtImports.contentHash })
        .from(ttmtImports).where(or(eq(ttmtImports.version, input.version), eq(ttmtImports.contentHash, input.contentHash))).limit(1);
      if (duplicate[0]?.version === input.version) throw new TtmtImportError("TTMT_VERSION_EXISTS", `เวอร์ชัน ${input.version} ถูกนำเข้าไว้แล้ว`);
      if (duplicate[0]) throw new TtmtImportError("TTMT_FILE_EXISTS", "ไฟล์ MasterTTMT นี้ถูกนำเข้าไว้แล้ว");

      await tx.insert(ttmtImports).values({
        id: input.importId, version: input.version, filename: input.filename, contentHash: input.contentHash,
        rowCount: input.products.length, status: "running", importedBy: input.importedBy, startedAt: input.startedAt,
      });
      for (let start = 0; start < input.products.length; start += UPSERT_CHUNK) {
        const values = input.products.slice(start, start + UPSERT_CHUNK).map((product) => ({
          ...product, sourceVersion: input.version, sourceImportId: input.importId,
        }));
        await tx.insert(ttmtProducts).values(values).onDuplicateKeyUpdate({ set: {
          activeingredient: sql`values(${ttmtProducts.activeingredient})`, strength: sql`values(${ttmtProducts.strength})`,
          dosageform: sql`values(${ttmtProducts.dosageform})`, contvalue: sql`values(${ttmtProducts.contvalue})`,
          contunit: sql`values(${ttmtProducts.contunit})`, dispunit: sql`values(${ttmtProducts.dispunit})`,
          tradename: sql`values(${ttmtProducts.tradename})`, manufacturer: sql`values(${ttmtProducts.manufacturer})`,
          fsn: sql`values(${ttmtProducts.fsn})`, status: sql`values(${ttmtProducts.status})`, nlem: sql`values(${ttmtProducts.nlem})`,
          registrationNumber: sql`values(${ttmtProducts.registrationNumber})`, sourceVersion: sql`values(${ttmtProducts.sourceVersion})`,
          sourceImportId: sql`values(${ttmtProducts.sourceImportId})`, normalizedGeneric: sql`values(${ttmtProducts.normalizedGeneric})`,
          normalizedTrade: sql`values(${ttmtProducts.normalizedTrade})`, normalizedManufacturer: sql`values(${ttmtProducts.normalizedManufacturer})`,
          normalizedRegno: sql`values(${ttmtProducts.normalizedRegno})`, updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        } });
      }
      const completedAt = new Date();
      await tx.update(ttmtImports).set({ status: "succeeded", completedAt }).where(eq(ttmtImports.id, input.importId));
      await tx.insert(auditLogs).values({
        id: randomUUID(), actorUserId: input.importedBy, action: "standards.ttmt_v2_imported",
        entityType: "ttmt_import", entityId: input.importId,
        afterJson: { version: input.version, filename: input.filename, rowCount: input.products.length, contentHash: input.contentHash },
        createdAt: completedAt,
      });
    });
  },
}; }

const defaultStore = createStore(db);

export function ttmtV2ImportStoreForPool(pool: Pool): TtmtV2ImportStore {
  return createStore(drizzle(pool, { schema, mode: "default" }) as typeof db);
}

export function analyzeMasterTtmtV2(input: { filename: string; version: string; data: Buffer }) {
  const version = input.version.trim();
  if (!version) throw new TtmtImportError("TTMT_VERSION_REQUIRED", "ต้องระบุเวอร์ชันของไฟล์ MasterTTMT");
  if (version.length > 120) throw new TtmtImportError("TTMT_VERSION_INVALID", "เวอร์ชัน MasterTTMT ยาวเกินกำหนด");
  if (!input.filename || input.filename.length > 255) throw new TtmtImportError("TTMT_FILENAME_INVALID", "ชื่อไฟล์ MasterTTMT ไม่ถูกต้อง");
  const parsed = parseMasterTtmt(input.data, { duplicatePolicy: "reject" });
  return {
    filename: input.filename, version, contentHash: createHash("sha256").update(input.data).digest("hex"),
    rowCount: parsed.products.length, products: parsed.products, warnings: parsed.warnings,
  };
}

export async function importMasterTtmtV2(
  input: { filename: string; version: string; data: Buffer; importedBy: string; dryRun: boolean },
  store: TtmtV2ImportStore = defaultStore,
) {
  const analysis = analyzeMasterTtmtV2(input);
  const importId = randomUUID();
  if (!input.dryRun) await store.commit({ ...analysis, importId, importedBy: input.importedBy, startedAt: new Date() });
  return { importId: input.dryRun ? null : importId, version: analysis.version, contentHash: analysis.contentHash, rowCount: analysis.rowCount, warnings: analysis.warnings, dryRun: input.dryRun };
}

export { TtmtImportError } from "./ttmt-parser";
