import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "@/db/client";
import {
  drugCatalogImports,
  drugCatalogRows,
  drugMappings,
  mappingExportCheckpoints,
  mappingReviewAcknowledgements,
  sourceDrugs,
} from "@/db/schema";
import { classifyMappingLifecycle } from "@/modules/mappings/lifecycle";
import {
  loadMappedStandardsV2,
  mappingV2IdentityKey,
  type MappingV2Identity,
  type ResolvedMappedStandardV2,
} from "@/modules/mappings/v2-consumer";
import { isExportCandidate, type ExportCandidateState, type ExportSelection } from "./delta";
import type { ExportCandidate, ExportRow } from "./rows";

type ExportQueryDb = Pick<typeof db, "select">;

function text(value: string | null | undefined): string {
  return value?.toString().trim() ?? "";
}

function contentText(contentValue: string | null, contentUnit: string | null, dispensingUnit: string | null): string {
  return [contentValue, contentUnit, dispensingUnit].map(text).filter(Boolean).join(" ");
}

export interface V2ExportRowBase {
  drugcode: string;
  sell: string | null;
  productCat: string;
  specPrep: string | null;
  dfscode: string | null;
  unitPrice: string | null;
  distributor: string | null;
  ndc24: string | null;
  packsize: string | null;
  packPrice: string | null;
  updateFlag: string;
  dateChange: string | null;
  dateUpdate: string | null;
  dateEffective: string | null;
}

export function exportRowFromV2Standard(base: V2ExportRowBase, standard: ResolvedMappedStandardV2): ExportRow {
  return {
    hospdrugcode: text(base.drugcode),
    productcat: text(base.productCat),
    tmtid: standard.code,
    specprep: text(base.specPrep),
    genericname: text(standard.activeIngredient),
    tradename: text(standard.tradeName),
    dfscode: text(base.dfscode),
    dosageform: text(standard.dosageForm),
    strength: text(standard.strength),
    content: contentText(standard.contentValue, standard.contentUnit, standard.dispensingUnit),
    unitprice: text(base.unitPrice) || text(base.sell),
    distributor: text(base.distributor),
    manufacturer: text(standard.manufacturer),
    ised: text(standard.exportIsed),
    ndc24: text(base.ndc24),
    packsize: text(base.packsize),
    packprice: text(base.packPrice),
    updateflag: text(base.updateFlag),
    datechange: base.dateChange,
    dateupdate: base.dateUpdate,
    dateeffective: base.dateEffective,
  };
}

/** V2 export path. It never joins standard_products and is selected only by the explicit export flag. */
export async function buildExportCandidatesV2(
  facilityId: string,
  selection: ExportSelection,
  database: ExportQueryDb = db,
  lockRows = false,
): Promise<ExportCandidate[]> {
  const latestCatalog = alias(drugCatalogRows, "latest_export_catalog_v2");
  const catalogHistory = database
    .select({ facilityId: drugCatalogRows.facilityId, hospdrugcode: drugCatalogRows.hospdrugcode })
    .from(drugCatalogRows)
    .where(eq(drugCatalogRows.facilityId, facilityId))
    .groupBy(drugCatalogRows.facilityId, drugCatalogRows.hospdrugcode)
    .as("export_catalog_history_v2");
  const latestImportId = sql<string>`(
    SELECT ${drugCatalogImports.id} FROM ${drugCatalogImports}
    WHERE ${drugCatalogImports.facilityId} = ${facilityId}
    ORDER BY ${drugCatalogImports.createdAt} DESC LIMIT 1
  )`;

  const query = database
    .select({
      facilityId: drugMappings.facilityId,
      mappingId: drugMappings.id,
      mappingSource: drugMappings.source,
      mappingUpdatedAt: drugMappings.updatedAt,
      standardSource: drugMappings.standardSource,
      standardCode: drugMappings.standardCode,
      standardLevel: drugMappings.standardLevel,
      checkpointFacilityId: mappingExportCheckpoints.facilityId,
      checkpointMappingId: mappingExportCheckpoints.mappingId,
      checkpointMappingUpdatedAt: mappingExportCheckpoints.mappingUpdatedAt,
      checkpointExportId: mappingExportCheckpoints.exportId,
      acknowledgedMappingUpdatedAt: mappingReviewAcknowledgements.mappingUpdatedAt,
      acknowledgedCatalogPresent: mappingReviewAcknowledgements.catalogPresent,
      acknowledgedCatalogTmtid: mappingReviewAcknowledgements.catalogTmtid,
      latestCatalogRowId: latestCatalog.id,
      latestCatalogTmtid: latestCatalog.tmtid,
      everInCatalog: sql<boolean>`${catalogHistory.hospdrugcode} IS NOT NULL`,
      drugcode: sourceDrugs.drugcode,
      sell: sourceDrugs.sell,
      productCat: drugMappings.productCat,
      specPrep: drugMappings.specPrep,
      dfscode: drugMappings.dfscode,
      unitPrice: drugMappings.unitPrice,
      distributor: drugMappings.distributor,
      ndc24: drugMappings.ndc24,
      packsize: drugMappings.packsize,
      packPrice: drugMappings.packPrice,
      updateFlag: drugMappings.updateFlag,
      dateChange: drugMappings.dateChange,
      dateUpdate: drugMappings.dateUpdate,
      dateEffective: drugMappings.dateEffective,
    })
    .from(drugMappings)
    .innerJoin(sourceDrugs, and(eq(sourceDrugs.id, drugMappings.sourceDrugId), eq(sourceDrugs.facilityId, drugMappings.facilityId)))
    .leftJoin(mappingReviewAcknowledgements, and(eq(mappingReviewAcknowledgements.facilityId, drugMappings.facilityId), eq(mappingReviewAcknowledgements.mappingId, drugMappings.id)))
    .leftJoin(latestCatalog, and(eq(latestCatalog.importId, latestImportId), eq(latestCatalog.facilityId, drugMappings.facilityId), eq(latestCatalog.hospdrugcode, sourceDrugs.drugcode)))
    .leftJoin(catalogHistory, and(eq(catalogHistory.facilityId, sourceDrugs.facilityId), eq(catalogHistory.hospdrugcode, sourceDrugs.drugcode)))
    .leftJoin(mappingExportCheckpoints, and(eq(mappingExportCheckpoints.facilityId, drugMappings.facilityId), eq(mappingExportCheckpoints.mappingId, drugMappings.id)))
    .where(and(eq(drugMappings.facilityId, facilityId), eq(sourceDrugs.active, 1)))
    .orderBy(asc(sourceDrugs.drugcode));
  const rows = await (lockRows ? query.for("update") : query);
  const identities: MappingV2Identity[] = rows.flatMap((row) =>
    (row.standardSource === "TMT" || row.standardSource === "TTMT") && row.standardLevel
      ? [{ source: row.standardSource, code: row.standardCode, level: row.standardLevel, productCat: row.productCat }]
      : [],
  );
  const standards = await loadMappedStandardsV2(identities, database);

  return rows.flatMap((row) => {
    const identity: MappingV2Identity | null = (row.standardSource === "TMT" || row.standardSource === "TTMT") && row.standardLevel
      ? { source: row.standardSource, code: row.standardCode, level: row.standardLevel, productCat: row.productCat }
      : null;
    const standard = identity ? standards.get(mappingV2IdentityKey(identity)) : null;
    const lifecycle = classifyMappingLifecycle({
      active: true,
      mapping: { source: row.mappingSource, standardCode: row.standardCode, standardSource: row.standardSource, standardLevel: row.standardLevel, updatedAt: row.mappingUpdatedAt },
      standardValid: standard?.eligible ?? false,
      inLatestCatalog: Boolean(row.latestCatalogRowId),
      latestCatalogTmtid: row.latestCatalogTmtid,
      everInCatalog: Boolean(row.everInCatalog),
      reviewAcknowledgement: row.acknowledgedMappingUpdatedAt && row.acknowledgedCatalogPresent !== null ? {
        mappingUpdatedAt: row.acknowledgedMappingUpdatedAt,
        catalogPresent: row.acknowledgedCatalogPresent,
        catalogTmtid: row.acknowledgedCatalogTmtid,
      } : null,
    });
    const candidate: ExportCandidateState = {
      facilityId: row.facilityId,
      mappingId: row.mappingId,
      mappingSource: row.mappingSource,
      mappingUpdatedAt: row.mappingUpdatedAt,
      checkpointExportId: row.checkpointExportId,
      status: lifecycle.status === "hidden" ? "needs_review" : lifecycle.status,
      standardValid: standard?.eligible ?? false,
      standardSource: row.standardSource,
      standardCode: row.standardCode,
      standardLevel: row.standardLevel,
    };
    const checkpoint = row.checkpointFacilityId && row.checkpointMappingId && row.checkpointMappingUpdatedAt ? {
      facilityId: row.checkpointFacilityId,
      mappingId: row.checkpointMappingId,
      mappingUpdatedAt: row.checkpointMappingUpdatedAt,
    } : null;
    if (!standard || !isExportCandidate(candidate, checkpoint, selection)) return [];
    return [{ ...candidate, row: exportRowFromV2Standard(row, standard) }];
  });
}
