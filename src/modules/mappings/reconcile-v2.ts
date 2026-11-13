import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, dbPool } from "@/db/client";
import { auditLogs, drugCatalogRows, drugMappings, sourceDrugs, tmtConcept, tmtDatasetConcepts } from "@/db/schema";
import { latestImport } from "@/modules/catalog/service";
import { decideCatalogReconcile } from "./lifecycle";
import { MappingRuleError, standardTypeForDrugType } from "./product-category";
import { loadMappedStandardsV2, mappingV2IdentityKey, type MappingV2Identity } from "./v2-consumer";
import type { ReconcileResult } from "./service";
import { activeStandardReleaseEnabled } from "@/modules/tmt/feature";
import { readActiveStandardRelease } from "@/modules/standards/active-release";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

/** Catalog v2 uses the catalog code as an exact source identity; it never traverses GPU→TPU automatically. */
export async function reconcileFromLatestCatalogV2(facilityId: string, userId: string): Promise<ReconcileResult> {
  const release = activeStandardReleaseEnabled() ? await readActiveStandardRelease(dbPool()) : undefined;
  const snapshot = await latestImport(facilityId);
  if (!snapshot) throw new MappingRuleError("CATALOG_SNAPSHOT_MISSING", "ยังไม่มีไฟล์ Drug Catalog สำหรับสถานบริการนี้");
  const [drugs, mapped, catalogRows, catalogHistory] = await Promise.all([
    db.select({ id: sourceDrugs.id, drugcode: sourceDrugs.drugcode, drugtype: sourceDrugs.drugtype })
      .from(sourceDrugs).where(and(eq(sourceDrugs.facilityId, facilityId), eq(sourceDrugs.active, 1))),
    db.select({ id: drugMappings.id, sourceDrugId: drugMappings.sourceDrugId, standardSource: drugMappings.standardSource, standardCode: drugMappings.standardCode, standardLevel: drugMappings.standardLevel, source: drugMappings.source })
      .from(drugMappings).where(eq(drugMappings.facilityId, facilityId)),
    db.select({ hospdrugcode: drugCatalogRows.hospdrugcode, tmtid: drugCatalogRows.tmtid, ndc24: drugCatalogRows.ndc24 })
      .from(drugCatalogRows).where(eq(drugCatalogRows.importId, snapshot.id)),
    db.selectDistinct({ hospdrugcode: drugCatalogRows.hospdrugcode }).from(drugCatalogRows).where(eq(drugCatalogRows.facilityId, facilityId)),
  ]);
  const mappingByDrugId = new Map(mapped.map((row) => [row.sourceDrugId, row]));
  const catalogByCode = new Map(catalogRows.map((row) => [row.hospdrugcode, row]));
  const historyCodes = new Set(catalogHistory.map((row) => row.hospdrugcode));
  const wantedTmt = [...new Set(drugs.flatMap((drug) => {
    const code = catalogByCode.get(drug.drugcode)?.tmtid;
    if (drug.drugtype !== "01" || !code) return [];
    try { return [BigInt(code)]; } catch { return []; }
  }))];
  const tmtLevels = wantedTmt.length
    ? release
      ? await db.select({ code: tmtDatasetConcepts.tmtid, level: tmtDatasetConcepts.levelName }).from(tmtDatasetConcepts).where(and(eq(tmtDatasetConcepts.datasetId, release.tmtDatasetId), inArray(tmtDatasetConcepts.tmtid, wantedTmt)))
      : await db.select({ code: tmtConcept.tmtid, level: tmtConcept.levelName }).from(tmtConcept).where(inArray(tmtConcept.tmtid, wantedTmt))
    : [];
  const levelByTmt = new Map(tmtLevels.flatMap((row) => row.code === null ? [] : [[row.code.toString(), row.level] as const]));
  const identities: MappingV2Identity[] = drugs.flatMap((drug) => {
    const code = catalogByCode.get(drug.drugcode)?.tmtid;
    if (!code) return [];
    try {
      const source = standardTypeForDrugType(drug.drugtype);
      const level = source === "TMT" ? levelByTmt.get(code) : "product";
      return level ? [{ source, code, level, productCat: source === "TMT" ? "1" : "3" }] : [];
    } catch { return []; }
  });
  const standards = await loadMappedStandardsV2(identities, db, release);
  const identityBySourceCode = new Map(identities.map((identity) => [`${identity.source}\u0000${identity.code}`, identity]));
  const result: ReconcileResult = { considered: 0, created: 0, updated: 0, needsReview: 0, skippedNoStandard: 0, skippedTypeMismatch: 0 };
  const now = new Date();
  const day = today();
  const inserts: Array<typeof drugMappings.$inferInsert> = [];
  const updates: Array<{ id: string; previousCode: string; identity: MappingV2Identity; ised: string | null; ndc24: string | null; drugcode: string }> = [];

  for (const drug of drugs) {
    result.considered += 1;
    const catalog = catalogByCode.get(drug.drugcode);
    const mapping = mappingByDrugId.get(drug.id) ?? null;
    const decision = decideCatalogReconcile({
      active: true,
      mapping: mapping ? { source: mapping.source, standardCode: mapping.standardCode } : null,
      inLatestCatalog: Boolean(catalog),
      latestCatalogTmtid: catalog?.tmtid ?? null,
      everInCatalog: historyCodes.has(drug.drugcode),
    });
    if (decision.action === "needs_review") { result.needsReview += 1; continue; }
    if (decision.action === "noop" && !catalog?.tmtid) {
      if (!mapping) result.skippedNoStandard += 1;
      continue;
    }
    let expectedSource: "TMT" | "TTMT";
    try { expectedSource = standardTypeForDrugType(drug.drugtype); }
    catch { result.skippedTypeMismatch += 1; continue; }
    const identity = catalog?.tmtid ? identityBySourceCode.get(`${expectedSource}\u0000${catalog.tmtid}`) : undefined;
    const standard = identity ? standards.get(mappingV2IdentityKey(identity)) : undefined;
    if (!identity || !standard?.eligible) {
      if (mapping) result.needsReview += 1;
      else result.skippedNoStandard += 1;
      continue;
    }
    if (decision.action === "noop") continue;
    if (decision.action === "create") {
      inserts.push({
        id: randomUUID(), facilityId, sourceDrugId: drug.id,
        standardSource: identity.source, standardCode: identity.code, standardLevel: identity.level,
        productCat: identity.productCat, specPrep: null, ised: standard.exportIsed, ndc24: catalog?.ndc24 ?? null,
        packsize: null, updateFlag: "E", dateChange: day, dateUpdate: day, dateEffective: day,
        source: "drug_catalog", catalogImportId: snapshot.id, mappedBy: userId, mappedAt: now, updatedAt: now,
      });
      result.created += 1;
    } else if (mapping) {
      updates.push({ id: mapping.id, previousCode: mapping.standardCode, identity, ised: standard.exportIsed, ndc24: catalog?.ndc24 ?? null, drugcode: drug.drugcode });
    }
  }

  if (inserts.length || updates.length) {
    await db.transaction(async (tx) => {
      for (let start = 0; start < inserts.length; start += 500) await tx.insert(drugMappings).values(inserts.slice(start, start + 500));
      for (const update of updates) {
        const [changed] = await tx.update(drugMappings).set({
          standardSource: update.identity.source, standardCode: update.identity.code, standardLevel: update.identity.level,
          productCat: update.identity.productCat, specPrep: null, ised: update.ised, ndc24: update.ndc24,
          packsize: null, updateFlag: "E", dateChange: day, dateUpdate: day, dateEffective: day,
          catalogImportId: snapshot.id, mappedBy: userId, updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        }).where(and(eq(drugMappings.id, update.id), eq(drugMappings.facilityId, facilityId), eq(drugMappings.source, "drug_catalog"), eq(drugMappings.standardCode, update.previousCode)));
        if (changed.affectedRows !== 1) continue;
        result.updated += 1;
        await tx.insert(auditLogs).values({
          id: randomUUID(), actorUserId: userId, effectiveFacilityId: facilityId,
          action: "mapping.catalog_updated", entityType: "drug_mapping", entityId: update.id,
          beforeJson: { standardCode: update.previousCode, source: "drug_catalog" },
          afterJson: { drugcode: update.drugcode, standardSource: update.identity.source, standardCode: update.identity.code, standardLevel: update.identity.level, catalogImportId: snapshot.id },
        });
      }
      await tx.insert(auditLogs).values({
        id: randomUUID(), actorUserId: userId, effectiveFacilityId: facilityId,
        action: "mapping.auto_reconciled", entityType: "drug_catalog_import", entityId: snapshot.id,
        afterJson: { ...result, model: "v2" },
      });
    });
  }
  return result;
}
