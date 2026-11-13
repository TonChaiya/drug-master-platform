import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, dbPool } from "@/db/client";
import { auditLogs, drugCatalogImports, drugCatalogRows, drugMappings, mappingReviewAcknowledgements, sourceDrugs } from "@/db/schema";
import { classifyMappingLifecycle } from "./lifecycle";
import { MappingRuleError, normalizeSpecPrep, resolveProductCategory, standardTypeForDrugType } from "./product-category";
import { MappingV2RuleError, requireEligibleMappingV2Standard, type MappingStandardSource } from "./v2";
import { decideUpdateFlagWithSnapshot } from "./update-flag";
import { activeStandardReleaseEnabled } from "@/modules/tmt/feature";
import { readActiveStandardRelease } from "@/modules/standards/active-release";

export interface SaveV2MappingInput {
  facilityId: string;
  userId: string;
  sourceDrugId: string;
  standardSource: MappingStandardSource;
  standardCode: string;
  standardLevel: string;
  productCat?: string | null;
  specPrep?: string | null;
  notes?: string | null;
  confirmReview?: boolean;
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

/**
 * Isolated v2 persistence path. It deliberately does not call the legacy
 * standard resolver, catalog reconcile, or export code before Phase 7.
 */
export async function saveV2Mapping(input: SaveV2MappingInput): Promise<{
  mappingId: string;
  updateFlag: "A" | "E";
  reviewConfirmed: boolean;
  reviewNoop: boolean;
}> {
  const [drug] = await db
    .select()
    .from(sourceDrugs)
    .where(and(eq(sourceDrugs.id, input.sourceDrugId), eq(sourceDrugs.facilityId, input.facilityId), eq(sourceDrugs.active, 1)))
    .limit(1);
  if (!drug) throw new MappingRuleError("SOURCE_DRUG_NOT_FOUND", "ไม่พบรายการยาในขอบเขตสถานบริการของคุณ");

  const expectedSource = standardTypeForDrugType(drug.drugtype);
  if (input.standardSource !== expectedSource) {
    throw new MappingV2RuleError("STANDARD_SOURCE_MISMATCH", `รหัสมาตรฐานต้องเป็น ${expectedSource} สำหรับชนิดยานี้`);
  }
  const productCat = resolveProductCategory(drug.drugtype, input.productCat);
  const specPrep = normalizeSpecPrep(productCat, input.specPrep);
  const release = activeStandardReleaseEnabled() ? await readActiveStandardRelease(dbPool()) : undefined;
  const standard = await requireEligibleMappingV2Standard({
    source: input.standardSource,
    code: input.standardCode,
    level: input.standardLevel,
    productCat,
  }, release);

  return db.transaction(async (tx) => {
    const [snapshot] = await tx
      .select({ id: drugCatalogImports.id })
      .from(drugCatalogImports)
      .where(eq(drugCatalogImports.facilityId, input.facilityId))
      .orderBy(desc(drugCatalogImports.createdAt))
      .limit(1);
    const [catalogRow] = snapshot
      ? await tx
          .select({ tmtid: drugCatalogRows.tmtid, ndc24: drugCatalogRows.ndc24 })
          .from(drugCatalogRows)
          .where(and(eq(drugCatalogRows.facilityId, input.facilityId), eq(drugCatalogRows.importId, snapshot.id), eq(drugCatalogRows.hospdrugcode, drug.drugcode)))
          .limit(1)
      : [];
    const [catalogHistory] = await tx
      .select({ id: drugCatalogRows.id })
      .from(drugCatalogRows)
      .where(and(eq(drugCatalogRows.facilityId, input.facilityId), eq(drugCatalogRows.hospdrugcode, drug.drugcode)))
      .limit(1);
    const [existing] = await tx
      .select({ id: drugMappings.id, standardSource: drugMappings.standardSource, standardCode: drugMappings.standardCode, standardLevel: drugMappings.standardLevel })
      .from(drugMappings)
      .where(and(eq(drugMappings.facilityId, input.facilityId), eq(drugMappings.sourceDrugId, drug.id)))
      .limit(1)
      .for("update");
    const sameIdentity =
      existing?.standardSource === standard.source && existing.standardCode === standard.code && existing.standardLevel === standard.level;
    const confirmOnly = Boolean(input.confirmReview && sameIdentity && input.productCat === undefined && input.specPrep === undefined && input.notes === undefined);
    const mappingId = existing?.id ?? randomUUID();
    const updateFlag = decideUpdateFlagWithSnapshot(Boolean(snapshot), Boolean(catalogRow));

    if (!confirmOnly) {
      const now = new Date();
      const day = today();
      const values = {
        facilityId: input.facilityId,
        sourceDrugId: drug.id,
        standardSource: standard.source,
        standardCode: standard.code,
        standardLevel: standard.level,
        productCat,
        specPrep,
        ised: null,
        ndc24: catalogRow?.ndc24 ?? null,
        updateFlag,
        dateChange: day,
        dateUpdate: day,
        dateEffective: day,
        notes: input.notes?.slice(0, 500) || null,
        source: "manual",
        catalogImportId: null,
        mappedBy: input.userId,
        mappedAt: now,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      };
      if (existing) {
        await tx.update(drugMappings).set(values).where(and(eq(drugMappings.id, existing.id), eq(drugMappings.facilityId, input.facilityId)));
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
        beforeJson: existing ? { standardSource: existing.standardSource, standardCode: existing.standardCode, standardLevel: existing.standardLevel } : null,
        afterJson: { drugcode: drug.drugcode, standardSource: standard.source, standardCode: standard.code, standardLevel: standard.level, productCat, updateFlag },
      });
    }

    const [saved] = await tx
      .select({ id: drugMappings.id, source: drugMappings.source, standardCode: drugMappings.standardCode, standardSource: drugMappings.standardSource, standardLevel: drugMappings.standardLevel, updatedAt: drugMappings.updatedAt })
      .from(drugMappings)
      .where(and(eq(drugMappings.id, mappingId), eq(drugMappings.facilityId, input.facilityId)))
      .limit(1);
    if (!saved) throw new MappingV2RuleError("MAPPING_NOT_FOUND", "ไม่พบผลจับคู่หลังบันทึก");

    let reviewConfirmed = false;
    let reviewNoop = false;
    if (input.confirmReview) {
      const lifecycle = classifyMappingLifecycle({
        active: true,
        mapping: saved,
        standardValid: standard.eligible,
        inLatestCatalog: Boolean(catalogRow),
        latestCatalogTmtid: catalogRow?.tmtid ?? null,
        everInCatalog: Boolean(catalogHistory),
      });
      const [ack] = await tx
        .select({ mappingUpdatedAt: mappingReviewAcknowledgements.mappingUpdatedAt, catalogPresent: mappingReviewAcknowledgements.catalogPresent, catalogTmtid: mappingReviewAcknowledgements.catalogTmtid })
        .from(mappingReviewAcknowledgements)
        .where(and(eq(mappingReviewAcknowledgements.facilityId, input.facilityId), eq(mappingReviewAcknowledgements.mappingId, mappingId)))
        .limit(1);
      const sameState =
        ack?.mappingUpdatedAt.getTime() === saved.updatedAt.getTime() &&
        ack.catalogPresent === Boolean(catalogRow) &&
        ack.catalogTmtid === (catalogRow?.tmtid ?? null);
      if (sameState) {
        reviewNoop = true;
      } else {
        await tx
          .insert(mappingReviewAcknowledgements)
          .values({ facilityId: input.facilityId, mappingId, mappingUpdatedAt: saved.updatedAt, catalogPresent: Boolean(catalogRow), catalogTmtid: catalogRow?.tmtid ?? null, catalogImportId: snapshot?.id ?? null, confirmedBy: input.userId, confirmedAt: sql`CURRENT_TIMESTAMP(3)` })
          .onDuplicateKeyUpdate({ set: { mappingUpdatedAt: saved.updatedAt, catalogPresent: Boolean(catalogRow), catalogTmtid: catalogRow?.tmtid ?? null, catalogImportId: snapshot?.id ?? null, confirmedBy: input.userId, confirmedAt: sql`CURRENT_TIMESTAMP(3)` } });
        await tx.insert(auditLogs).values({
          id: randomUUID(), actorUserId: input.userId, effectiveFacilityId: input.facilityId, action: "mapping.review_confirmed", entityType: "drug_mapping", entityId: mappingId,
          afterJson: { standardSource: saved.standardSource, standardCode: saved.standardCode, standardLevel: saved.standardLevel, mappingUpdatedAt: saved.updatedAt, catalogPresent: Boolean(catalogRow), catalogTmtid: catalogRow?.tmtid ?? null, lifecycleBeforeAcknowledgement: lifecycle.status },
        });
        reviewConfirmed = true;
      }
    }
    return { mappingId, updateFlag, reviewConfirmed, reviewNoop };
  });
}
