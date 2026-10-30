import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLogs,
  drugCatalogImports,
  drugCatalogRows,
  drugMappings,
  mappingReviewAcknowledgements,
  sourceDrugs,
  standardProducts,
} from "@/db/schema";
import { latestImport } from "@/modules/catalog/service";
import { classifyMappingLifecycle, decideCatalogReconcile } from "./lifecycle";
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
  confirmReview?: boolean;
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
export async function saveManualMapping(input: ManualMappingInput): Promise<{
  mappingId: string;
  updateFlag: "A" | "E";
  reviewConfirmed: boolean;
  reviewNoop: boolean;
}> {
  const drug = await requireSourceDrug(input.facilityId, input.sourceDrugId);
  const expectedType = standardTypeForDrugType(drug.drugtype);
  const standard = await requireActiveStandard(input.standardCode, expectedType);

  const productCat = resolveProductCategory(drug.drugtype, input.productCat);
  const specPrep = normalizeSpecPrep(productCat, input.specPrep);

  const now = new Date();
  const day = today();
  return db.transaction(async (tx) => {
    const [snapshot] = await tx
      .select({ id: drugCatalogImports.id })
      .from(drugCatalogImports)
      .where(eq(drugCatalogImports.facilityId, input.facilityId))
      .orderBy(desc(drugCatalogImports.createdAt))
      .limit(1);
    const [catalogRow] = snapshot
      ? await tx
          .select({ id: drugCatalogRows.id, tmtid: drugCatalogRows.tmtid, ndc24: drugCatalogRows.ndc24 })
          .from(drugCatalogRows)
          .where(
            and(
              eq(drugCatalogRows.facilityId, input.facilityId),
              eq(drugCatalogRows.importId, snapshot.id),
              eq(drugCatalogRows.hospdrugcode, drug.drugcode),
            ),
          )
          .limit(1)
      : [];
    const [catalogHistory] = await tx
      .select({ id: drugCatalogRows.id })
      .from(drugCatalogRows)
      .where(and(eq(drugCatalogRows.facilityId, input.facilityId), eq(drugCatalogRows.hospdrugcode, drug.drugcode)))
      .limit(1);
    const updateFlag = decideUpdateFlagWithSnapshot(Boolean(snapshot), Boolean(catalogRow));
    const [existing] = await tx
      .select({
        id: drugMappings.id,
        standardCode: drugMappings.standardCode,
      })
      .from(drugMappings)
      .where(and(eq(drugMappings.facilityId, input.facilityId), eq(drugMappings.sourceDrugId, drug.id)))
      .limit(1)
      .for("update");

    const hasExplicitMappingFields = [
      input.productCat,
      input.specPrep,
      input.dfscode,
      input.unitPrice,
      input.distributor,
      input.ndc24,
      input.packsize,
      input.packPrice,
      input.dateChange,
      input.dateUpdate,
      input.dateEffective,
      input.notes,
    ].some((value) => value !== undefined);
    const confirmOnly = Boolean(input.confirmReview && existing?.standardCode === standard.standardCode && !hasExplicitMappingFields);
    const mappingId = existing?.id ?? randomUUID();

    if (!confirmOnly) {
      const values = {
        facilityId: input.facilityId,
        sourceDrugId: drug.id,
        standardCode: standard.standardCode,
        productCat,
        specPrep,
        dfscode: input.dfscode?.trim() || null,
        unitPrice: input.unitPrice?.trim() || null,
        distributor: input.distributor?.trim() || null,
        ised: standard.exportIsed,
        ndc24: input.ndc24?.trim() || catalogRow?.ndc24 || null,
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
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      };
      if (existing) {
        await tx
          .update(drugMappings)
          .set(values)
          .where(and(eq(drugMappings.id, existing.id), eq(drugMappings.facilityId, input.facilityId)));
      } else {
        await tx.insert(drugMappings).values({ id: mappingId, ...values });
      }
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actorUserId: input.userId,
        effectiveFacilityId: input.facilityId,
        action: existing ? "mapping.updated" : "mapping.created",
        entityType: "drug_mapping",
        entityId: mappingId,
        afterJson: { drugcode: drug.drugcode, standardCode: standard.standardCode, productCat, updateFlag },
      });
    }

    const [savedMapping] = await tx
      .select({
        id: drugMappings.id,
        source: drugMappings.source,
        standardCode: drugMappings.standardCode,
        updatedAt: drugMappings.updatedAt,
      })
      .from(drugMappings)
      .where(and(eq(drugMappings.id, mappingId), eq(drugMappings.facilityId, input.facilityId)))
      .limit(1);
    if (!savedMapping) throw new MappingRuleError("MAPPING_NOT_FOUND", "ไม่พบผลจับคู่หลังบันทึก");

    let reviewConfirmed = false;
    let reviewNoop = false;
    if (input.confirmReview) {
      const lifecycle = classifyMappingLifecycle({
        active: true,
        mapping: savedMapping,
        inLatestCatalog: Boolean(catalogRow),
        latestCatalogTmtid: catalogRow?.tmtid ?? null,
        everInCatalog: Boolean(catalogHistory),
      });
      const [acknowledgement] = await tx
        .select({
          mappingUpdatedAt: mappingReviewAcknowledgements.mappingUpdatedAt,
          catalogPresent: mappingReviewAcknowledgements.catalogPresent,
          catalogTmtid: mappingReviewAcknowledgements.catalogTmtid,
        })
        .from(mappingReviewAcknowledgements)
        .where(
          and(
            eq(mappingReviewAcknowledgements.facilityId, input.facilityId),
            eq(mappingReviewAcknowledgements.mappingId, mappingId),
          ),
        )
        .limit(1);
      const sameState =
        acknowledgement?.mappingUpdatedAt.getTime() === savedMapping.updatedAt.getTime() &&
        acknowledgement.catalogPresent === Boolean(catalogRow) &&
        acknowledgement.catalogTmtid === (catalogRow?.tmtid ?? null);
      if (sameState) {
        reviewNoop = true;
      } else {
        await tx
          .insert(mappingReviewAcknowledgements)
          .values({
            facilityId: input.facilityId,
            mappingId,
            mappingUpdatedAt: savedMapping.updatedAt,
            catalogPresent: Boolean(catalogRow),
            catalogTmtid: catalogRow?.tmtid ?? null,
            catalogImportId: snapshot?.id ?? null,
            confirmedBy: input.userId,
            confirmedAt: sql`CURRENT_TIMESTAMP(3)`,
          })
          .onDuplicateKeyUpdate({
            set: {
              mappingUpdatedAt: savedMapping.updatedAt,
              catalogPresent: Boolean(catalogRow),
              catalogTmtid: catalogRow?.tmtid ?? null,
              catalogImportId: snapshot?.id ?? null,
              confirmedBy: input.userId,
              confirmedAt: sql`CURRENT_TIMESTAMP(3)`,
            },
          });
        await tx.insert(auditLogs).values({
          id: randomUUID(),
          actorUserId: input.userId,
          effectiveFacilityId: input.facilityId,
          action: "mapping.review_confirmed",
          entityType: "drug_mapping",
          entityId: mappingId,
          afterJson: {
            mappingUpdatedAt: savedMapping.updatedAt,
            catalogPresent: Boolean(catalogRow),
            catalogTmtid: catalogRow?.tmtid ?? null,
            catalogImportId: snapshot?.id ?? null,
            lifecycleBeforeAcknowledgement: lifecycle.status,
          },
        });
        reviewConfirmed = true;
      }
    }

    return { mappingId, updateFlag, reviewConfirmed, reviewNoop };
  });
}

export interface ReconcileResult {
  considered: number;
  created: number;
  updated: number;
  needsReview: number;
  skippedNoStandard: number;
  skippedTypeMismatch: number;
}

/**
 * Auto-maps from the facility's latest Drug Catalog snapshot.
 *
 * A row is auto-mapped only when the catalogue's TMTID exists in our standard
 * catalogue, is active, and matches the drug type. Catalogue-owned mappings
 * follow the latest snapshot; manual mappings are never overwritten.
 */
export async function reconcileFromLatestCatalog(facilityId: string, userId: string): Promise<ReconcileResult> {
  const snapshot = await latestImport(facilityId);
  if (!snapshot) throw new MappingRuleError("CATALOG_SNAPSHOT_MISSING", "ยังไม่มีไฟล์ Drug Catalog สำหรับสถานบริการนี้");

  const drugs = await db
    .select({ id: sourceDrugs.id, drugcode: sourceDrugs.drugcode, drugtype: sourceDrugs.drugtype })
    .from(sourceDrugs)
    .where(and(eq(sourceDrugs.facilityId, facilityId), eq(sourceDrugs.active, 1)));

  const mapped = await db
    .select({
      id: drugMappings.id,
      sourceDrugId: drugMappings.sourceDrugId,
      standardCode: drugMappings.standardCode,
      source: drugMappings.source,
    })
    .from(drugMappings)
    .where(eq(drugMappings.facilityId, facilityId));
  const mappingByDrugId = new Map(mapped.map((row) => [row.sourceDrugId, row]));

  const catalogRows = await db
    .select({ hospdrugcode: drugCatalogRows.hospdrugcode, tmtid: drugCatalogRows.tmtid, ndc24: drugCatalogRows.ndc24 })
    .from(drugCatalogRows)
    .where(eq(drugCatalogRows.importId, snapshot.id));
  const catalogByCode = new Map(catalogRows.map((row) => [row.hospdrugcode, row]));
  const catalogHistory = await db
    .selectDistinct({ hospdrugcode: drugCatalogRows.hospdrugcode })
    .from(drugCatalogRows)
    .where(eq(drugCatalogRows.facilityId, facilityId));
  const catalogHistoryCodes = new Set(catalogHistory.map((row) => row.hospdrugcode));

  const wantedCodes = [...new Set(catalogRows.map((row) => row.tmtid).filter((code): code is string => Boolean(code)))];
  const standards = wantedCodes.length
    ? await db
        .select({ standardCode: standardProducts.standardCode, standardType: standardProducts.standardType, exportIsed: standardProducts.exportIsed })
        .from(standardProducts)
        .where(and(inArray(standardProducts.standardCode, wantedCodes), eq(standardProducts.status, "active")))
    : [];
  const standardByCode = new Map(standards.map((row) => [row.standardCode, row]));

  const result: ReconcileResult = { considered: 0, created: 0, updated: 0, needsReview: 0, skippedNoStandard: 0, skippedTypeMismatch: 0 };
  const now = new Date();
  const day = today();
  const pending: (typeof drugMappings.$inferInsert)[] = [];
  const updates: {
    mappingId: string;
    sourceDrugId: string;
    drugcode: string;
    previousStandardCode: string;
    standardCode: string;
    productCat: string;
    ised: string | null;
    ndc24: string | null;
  }[] = [];

  for (const drug of drugs) {
    result.considered += 1;
    const catalogRow = catalogByCode.get(drug.drugcode);
    const mapping = mappingByDrugId.get(drug.id) ?? null;
    const decision = decideCatalogReconcile({
      active: true,
      mapping: mapping ? { source: mapping.source, standardCode: mapping.standardCode } : null,
      inLatestCatalog: Boolean(catalogRow),
      latestCatalogTmtid: catalogRow?.tmtid ?? null,
      everInCatalog: catalogHistoryCodes.has(drug.drugcode),
    });
    if (decision.action === "noop") {
      if (!catalogRow?.tmtid && !mapping) result.skippedNoStandard += 1;
      continue;
    }
    if (decision.action === "needs_review") {
      result.needsReview += 1;
      continue;
    }
    const standard = standardByCode.get(decision.standardCode);
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

    const productCat = drug.drugtype === "10" ? "3" : "1";
    if (decision.action === "create") {
      pending.push({
        id: randomUUID(),
        facilityId,
        sourceDrugId: drug.id,
        standardCode: standard.standardCode,
        productCat,
        specPrep: null,
        ised: standard.exportIsed,
        // From the file, like TMTID itself — not from cdrug.drugcode24.
        ndc24: catalogRow?.ndc24 ?? null,
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
    } else if (mapping) {
      updates.push({
        mappingId: mapping.id,
        sourceDrugId: drug.id,
        drugcode: drug.drugcode,
        previousStandardCode: mapping.standardCode,
        standardCode: standard.standardCode,
        productCat,
        ised: standard.exportIsed,
        ndc24: catalogRow?.ndc24 ?? null,
      });
    }
  }

  if (pending.length > 0 || updates.length > 0) {
    await db.transaction(async (tx) => {
      for (let start = 0; start < pending.length; start += 500) {
        await tx.insert(drugMappings).values(pending.slice(start, start + 500));
      }
      for (const update of updates) {
        const [updateResult] = await tx
          .update(drugMappings)
          .set({
            standardCode: update.standardCode,
            productCat: update.productCat,
            specPrep: null,
            ised: update.ised,
            ndc24: update.ndc24,
            packsize: null,
            updateFlag: "E",
            dateChange: day,
            dateUpdate: day,
            dateEffective: day,
            catalogImportId: snapshot.id,
            mappedBy: userId,
            updatedAt: now,
          })
          .where(
            and(
              eq(drugMappings.id, update.mappingId),
              eq(drugMappings.facilityId, facilityId),
              eq(drugMappings.source, "drug_catalog"),
              eq(drugMappings.standardCode, update.previousStandardCode),
            ),
          );
        if (updateResult.affectedRows !== 1) continue;
        result.updated += 1;
        await tx.insert(auditLogs).values({
          id: randomUUID(),
          actorUserId: userId,
          effectiveFacilityId: facilityId,
          action: "mapping.catalog_updated",
          entityType: "drug_mapping",
          entityId: update.mappingId,
          beforeJson: { sourceDrugId: update.sourceDrugId, standardCode: update.previousStandardCode, source: "drug_catalog" },
          afterJson: { drugcode: update.drugcode, standardCode: update.standardCode, catalogImportId: snapshot.id },
        });
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
