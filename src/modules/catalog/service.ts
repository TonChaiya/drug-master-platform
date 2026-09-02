import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, drugCatalogImports, drugCatalogRows } from "@/db/schema";
import { CatalogParseError, parseDrugCatalog, type ParsedCatalogRow } from "./parser";

const INSERT_CHUNK = 500;

export interface ImportResult {
  importId: string;
  rowCount: number;
  skippedEmptyRows: number;
  format: "xls" | "xlsx";
  contentHash: string;
}

export function contentHashOf(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Maps a parsed sheet row onto the catalog row columns, field by field. */
function toRowInsert(importId: string, facilityId: string) {
  return (row: ParsedCatalogRow): typeof drugCatalogRows.$inferInsert => ({
    id: randomUUID(),
    importId,
    facilityId,
    sourceRowNumber: row.sourceRowNumber,
    hospdrugcode: row.values.hospdrugcode ?? "",
    productcat: row.values.productcat,
    tmtid: row.values.tmtid,
    specprep: row.values.specprep,
    genericname: row.values.genericname,
    tradename: row.values.tradename,
    dfscode: row.values.dfscode,
    dosageform: row.values.dosageform,
    strength: row.values.strength,
    content: row.values.content,
    unitprice: row.values.unitprice,
    distributor: row.values.distributor,
    manufacturer: row.values.manufacturer,
    ised: row.values.ised,
    ndc24: row.values.ndc24,
    packsize: row.values.packsize,
    packprice: row.values.packprice,
    updateflag: row.values.updateflag,
    datechange: row.values.datechange,
    dateupdate: row.values.dateupdate,
    dateeffective: row.values.dateeffective,
  });
}

/**
 * Imports one DrugCat file for a facility.
 *
 * The whole file is parsed and validated before anything is written, and the
 * write itself is one transaction, so a rejected file never leaves a partial
 * snapshot behind. Re-uploading an identical file is refused via the
 * (facility, content hash) unique key rather than silently duplicating.
 */
export async function importDrugCatalog(options: {
  facilityId: string;
  userId: string;
  filename: string;
  data: Buffer;
  sourceVersion?: string | null;
  sourceDate?: string | null;
}): Promise<ImportResult> {
  const parsed = parseDrugCatalog(options.data);
  const contentHash = contentHashOf(options.data);

  const existing = await db
    .select({ id: drugCatalogImports.id, createdAt: drugCatalogImports.createdAt })
    .from(drugCatalogImports)
    .where(and(eq(drugCatalogImports.facilityId, options.facilityId), eq(drugCatalogImports.contentHash, contentHash)))
    .limit(1);
  if (existing[0]) {
    throw new CatalogParseError(
      "CATALOG_DUPLICATE_FILE",
      "ไฟล์นี้เคยนำเข้าแล้ว (เนื้อหาไฟล์เหมือนกันทุกไบต์)",
      [`นำเข้าครั้งก่อนเมื่อ ${existing[0].createdAt.toISOString()}`],
    );
  }

  const importId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(drugCatalogImports).values({
      id: importId,
      facilityId: options.facilityId,
      filename: options.filename.slice(0, 255),
      contentHash,
      sourceVersion: options.sourceVersion?.slice(0, 120) ?? null,
      sourceDate: options.sourceDate ?? null,
      rowCount: parsed.rows.length,
      importedBy: options.userId,
    });

    for (let start = 0; start < parsed.rows.length; start += INSERT_CHUNK) {
      const chunk = parsed.rows.slice(start, start + INSERT_CHUNK).map(toRowInsert(importId, options.facilityId));
      await tx.insert(drugCatalogRows).values(chunk);
    }

    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.userId,
      effectiveFacilityId: options.facilityId,
      action: "catalog.imported",
      entityType: "drug_catalog_import",
      entityId: importId,
      afterJson: {
        filename: options.filename,
        rowCount: parsed.rows.length,
        format: parsed.format,
        contentHash,
      },
    });
  });

  return {
    importId,
    rowCount: parsed.rows.length,
    skippedEmptyRows: parsed.skippedEmptyRows,
    format: parsed.format,
    contentHash,
  };
}

/** The comparison snapshot: the most recent import for this facility. */
export async function latestImport(facilityId: string) {
  const rows = await db
    .select()
    .from(drugCatalogImports)
    .where(eq(drugCatalogImports.facilityId, facilityId))
    .orderBy(desc(drugCatalogImports.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listImports(facilityId: string, limit = 20) {
  return db
    .select({
      id: drugCatalogImports.id,
      filename: drugCatalogImports.filename,
      rowCount: drugCatalogImports.rowCount,
      sourceVersion: drugCatalogImports.sourceVersion,
      sourceDate: drugCatalogImports.sourceDate,
      createdAt: drugCatalogImports.createdAt,
      contentHash: drugCatalogImports.contentHash,
    })
    .from(drugCatalogImports)
    .where(eq(drugCatalogImports.facilityId, facilityId))
    .orderBy(desc(drugCatalogImports.createdAt))
    .limit(limit);
}

export async function previewImportRows(facilityId: string, importId: string, limit = 50) {
  return db
    .select()
    .from(drugCatalogRows)
    .where(and(eq(drugCatalogRows.facilityId, facilityId), eq(drugCatalogRows.importId, importId)))
    .orderBy(drugCatalogRows.sourceRowNumber)
    .limit(limit);
}

/** Looks up one HOSPDRUGCODE inside the latest snapshot — the A/E decision input. */
export async function findInLatestSnapshot(facilityId: string, hospdrugcode: string) {
  const snapshot = await latestImport(facilityId);
  if (!snapshot) return null;
  const rows = await db
    .select()
    .from(drugCatalogRows)
    .where(and(eq(drugCatalogRows.importId, snapshot.id), eq(drugCatalogRows.hospdrugcode, hospdrugcode)))
    .limit(1);
  return rows[0] ?? null;
}

export async function countSnapshotRows(importId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(drugCatalogRows)
    .where(eq(drugCatalogRows.importId, importId));
  return Number(row?.total ?? 0);
}
