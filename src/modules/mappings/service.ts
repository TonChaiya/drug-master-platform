import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, drugCatalogRows, drugMappings, sourceDrugs, standardProducts } from "@/db/schema";
import { latestImport } from "@/modules/catalog/service";
import { MappingRuleError, normalizeSpecPrep, resolveProductCategory, standardTypeForDrugType } from "./product-category";
import { decideUpdateFlagWithSnapshot } from "./update-flag";

export interface ManualMappingInput {
  facilityId: string;
  userId: string;
  sourceDrugId: string;
  standardCode: string;
  productCat?: string | null;
  specPrep?: string | null;
  dfscode?: string | null;
  unitPrice?: string | null;
  distributor?: string | null;
  ndc24?: string | null;
  packsize?: string | null;
  packPrice?: string | null;
  dateChange?: string | null;
  dateUpdate?: string | null;
  dateEffective?: string | null;
  notes?: string | null;
}

function today(): string {
  // Business dates are Bangkok-local; timestamps stay UTC in the database.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

async function requireSourceDrug(facilityId: string, sourceDrugId: string) {
  const rows = await db
    .select()
    .from(sourceDrugs)
    .where(and(eq(sourceDrugs.id, sourceDrugId), eq(sourceDrugs.facilityId, facilityId), eq(sourceDrugs.active, 1)))
    .limit(1);
  const drug = rows[0];
  if (!drug) throw new MappingRuleError("SOURCE_DRUG_NOT_FOUND", "ไม่พบรายการยาในขอบเขตสถานบริการของคุณ");
  return drug;
}

async function requireActiveStandard(standardCode: string, expectedType: "TMT" | "TTMT") {
  const rows = await db
    .select()
    .from(standardProducts)
    .where(and(eq(standardProducts.standardCode, standardCode), eq(standardProducts.standardType, expectedType), eq(standardProducts.status, "active")))
    .limit(1);
  const standard = rows[0];
  if (!standard) {
    throw new MappingRuleError(
      "STANDARD_NOT_ELIGIBLE",
      `รหัสมาตรฐานไม่ตรงกับประเภทยา (ต้องเป็น ${expectedType}) หรือไม่ได้เปิดใช้งานอยู่`,
    );
  }
  return standard;
}

/**
 * Saves a manual mapping. Every rule that can reject the row runs before any
 * write, and the mapping is immediately exportable — there is no approval state
 * in this system (docs/SPEC.md).
 */
export async function saveManualMapping(input: ManualMappingInput): Promise<{ mappingId: string; updateFlag: "A" | "E" }> {
  const drug = await requireSourceDrug(input.facilityId, input.sourceDrugId);
  const expectedType = standardTypeForDrugType(drug.drugtype);
  const standard = await requireActiveStandard(input.standardCode, expectedType);

  const productCat = resolveProductCategory(drug.drugtype, input.productCat);
  const specPrep = normalizeSpecPrep(productCat, input.specPrep);

  const snapshot = await latestImport(input.facilityId);
  let presentInSnapshot = false;
  let catalogNdc24: string | null = null;
  if (snapshot) {
    const rows = await db
      .select({ id: drugCatalogRows.id, ndc24: drugCatalogRows.ndc24 })
      .from(drugCatalogRows)
      .where(and(eq(drugCatalogRows.importId, snapshot.id), eq(drugCatalogRows.hospdrugcode, drug.drugcode)))
      .limit(1);
    presentInSnapshot = rows.length > 0;
    catalogNdc24 = rows[0]?.ndc24 ?? null;
  }
  const updateFlag = decideUpdateFlagWithSnapshot(Boolean(snapshot), presentInSnapshot);

  const now = new Date();
  const day = today();
  const existing = await db
    .select({ id: drugMappings.id })
    .from(drugMappings)
    .where(and(eq(drugMappings.facilityId, input.facilityId), eq(drugMappings.sourceDrugId, drug.id)))
    .limit(1);

  const values = {
    facilityId: input.facilityId,
    sourceDrugId: drug.id,
    standardCode: standard.standardCode,
    productCat,
    specPrep,
    dfscode: input.dfscode?.trim() || null,
    unitPrice: input.unitPrice?.trim() || null,
    distributor: input.distributor?.trim() || null,
    // ISED always comes from the standard, never from user input.
    ised: standard.exportIsed,
    // NDC24 comes from the Drug Catalog file, never from cdrug.drugcode24:
    // the file has already been through the central system that validates it,
    // and JHCIS is not reliably right. Absent from the file means absent here.
    ndc24: input.ndc24?.trim() || catalogNdc24 || null,
    // PACKSIZE has no TMT field and is empty on every row of the approved
    // DrugCat files, so it carries only what a user typed. cdrug.pack is a
    // different quantity and putting it here would invent a value.
    packsize: input.packsize?.trim() || null,
    packPrice: input.packPrice?.trim() || null,
    updateFlag,
    dateChange: input.dateChange || day,
    dateUpdate: input.dateUpdate || day,
    dateEffective: input.dateEffective || day,
    notes: input.notes?.slice(0, 500) || null,
    source: "manual",
    catalogImportId: null,
    mappedBy: input.userId,
    mappedAt: now,
    updatedAt: now,
  };

  const mappingId = existing[0]?.id ?? randomUUID();
  await db.transaction(async (tx) => {
    if (existing[0]) {
      await tx.update(drugMappings).set(values).where(eq(drugMappings.id, existing[0].id));
    } else {
      await tx.insert(drugMappings).values({ id: mappingId, ...values });
    }
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: input.userId,
      effectiveFacilityId: input.facilityId,
      action: existing[0] ? "mapping.updated" : "mapping.created",
      entityType: "drug_mapping",
      entityId: mappingId,
      afterJson: { drugcode: drug.drugcode, standardCode: standard.standardCode, productCat, updateFlag },
    });
  });

  return { mappingId, updateFlag };
}

export interface ReconcileResult {
  considered: number;
  created: number;
  skippedAlreadyMapped: number;
  skippedNoStandard: number;
  skippedTypeMismatch: number;
}

/**
 * Auto-maps from the facility's latest Drug Catalog snapshot.
 *
 * A row is auto-mapped only when the catalogue's TMTID exists in our standard
 * catalogue, is active, and matches the drug type. Existing mappings are never
 * overwritten — a user's manual decision outranks the file.
 */
export async function reconcileFromLatestCatalog(facilityId: string, userId: string): Promise<ReconcileResult> {
  const snapshot = await latestImport(facilityId);
  if (!snapshot) throw new MappingRuleError("CATALOG_SNAPSHOT_MISSING", "ยังไม่มีไฟล์ Drug Catalog สำหรับสถานบริการนี้");

  const drugs = await db
    .select({ id: sourceDrugs.id, drugcode: sourceDrugs.drugcode, drugtype: sourceDrugs.drugtype })
    .from(sourceDrugs)
    .where(and(eq(sourceDrugs.facilityId, facilityId), eq(sourceDrugs.active, 1)));

  const mapped = await db
    .select({ sourceDrugId: drugMappings.sourceDrugId })
    .from(drugMappings)
    .where(eq(drugMappings.facilityId, facilityId));
  const alreadyMapped = new Set(mapped.map((row) => row.sourceDrugId));

  const catalogRows = await db
    .select({ hospdrugcode: drugCatalogRows.hospdrugcode, tmtid: drugCatalogRows.tmtid, ndc24: drugCatalogRows.ndc24 })
    .from(drugCatalogRows)
    .where(eq(drugCatalogRows.importId, snapshot.id));
  const catalogByCode = new Map(catalogRows.map((row) => [row.hospdrugcode, row]));

  const wantedCodes = [...new Set(catalogRows.map((row) => row.tmtid).filter((code): code is string => Boolean(code)))];
  const standards = wantedCodes.length
    ? await db
        .select({ standardCode: standardProducts.standardCode, standardType: standardProducts.standardType, exportIsed: standardProducts.exportIsed })
        .from(standardProducts)
        .where(and(inArray(standardProducts.standardCode, wantedCodes), eq(standardProducts.status, "active")))
    : [];
  const standardByCode = new Map(standards.map((row) => [row.standardCode, row]));

  const result: ReconcileResult = { considered: 0, created: 0, skippedAlreadyMapped: 0, skippedNoStandard: 0, skippedTypeMismatch: 0 };
  const now = new Date();
  const day = today();
  const pending: (typeof drugMappings.$inferInsert)[] = [];

  for (const drug of drugs) {
    result.considered += 1;
    if (alreadyMapped.has(drug.id)) {
      result.skippedAlreadyMapped += 1;
      continue;
    }
    const catalogRow = catalogByCode.get(drug.drugcode);
    if (!catalogRow?.tmtid) {
      result.skippedNoStandard += 1;
      continue;
    }
    const standard = standardByCode.get(catalogRow.tmtid);
    if (!standard) {
      result.skippedNoStandard += 1;
      continue;
    }
    let expectedType: "TMT" | "TTMT";
    try {
      expectedType = standardTypeForDrugType(drug.drugtype);
    } catch {
      result.skippedTypeMismatch += 1;
      continue;
    }
    if (standard.standardType !== expectedType) {
      result.skippedTypeMismatch += 1;
      continue;
    }

    pending.push({
      id: randomUUID(),
      facilityId,
      sourceDrugId: drug.id,
      standardCode: standard.standardCode,
      productCat: drug.drugtype === "10" ? "3" : "1",
      specPrep: null,
      ised: standard.exportIsed,
      // From the file, like TMTID itself — not from cdrug.drugcode24.
      ndc24: catalogRow.ndc24,
      packsize: null,
      // The code exists in the latest snapshot, so this is an edit, not an add.
      updateFlag: "E",
      dateChange: day,
      dateUpdate: day,
      dateEffective: day,
      source: "drug_catalog",
      catalogImportId: snapshot.id,
      mappedBy: userId,
      mappedAt: now,
      updatedAt: now,
    });
    result.created += 1;
  }

  if (pending.length > 0) {
    await db.transaction(async (tx) => {
      for (let start = 0; start < pending.length; start += 500) {
        await tx.insert(drugMappings).values(pending.slice(start, start + 500));
      }
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actorUserId: userId,
        effectiveFacilityId: facilityId,
        action: "mapping.auto_reconciled",
        entityType: "drug_catalog_import",
        entityId: snapshot.id,
        afterJson: { ...result },
      });
    });
  }

  return result;
}

export async function deleteMapping(facilityId: string, mappingId: string, userId: string): Promise<void> {
  const rows = await db
    .select({ id: drugMappings.id, sourceDrugId: drugMappings.sourceDrugId, standardCode: drugMappings.standardCode })
    .from(drugMappings)
    .where(and(eq(drugMappings.id, mappingId), eq(drugMappings.facilityId, facilityId)))
    .limit(1);
  const mapping = rows[0];
  if (!mapping) throw new MappingRuleError("MAPPING_NOT_FOUND", "ไม่พบผลจับคู่ในขอบเขตที่เลือก");

  await db.transaction(async (tx) => {
    await tx.delete(drugMappings).where(eq(drugMappings.id, mappingId));
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: userId,
      effectiveFacilityId: facilityId,
      action: "mapping.deleted",
      entityType: "drug_mapping",
      entityId: mappingId,
      beforeJson: { standardCode: mapping.standardCode, sourceDrugId: mapping.sourceDrugId },
    });
  });
}

/** Admin-only bulk clear for one facility. Always audited. */
export async function clearMappings(facilityId: string, userId: string): Promise<number> {
  const [counted] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(drugMappings)
    .where(eq(drugMappings.facilityId, facilityId));
  const total = Number(counted?.total ?? 0);

  await db.transaction(async (tx) => {
    await tx.delete(drugMappings).where(eq(drugMappings.facilityId, facilityId));
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: userId,
      effectiveFacilityId: facilityId,
      action: "mapping.cleared",
      entityType: "facility",
      entityId: facilityId,
      beforeJson: { deletedCount: total },
    });
  });
  return total;
}
