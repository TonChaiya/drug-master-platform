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
  standardProducts,
} from "@/db/schema";
import { classifyMappingLifecycle } from "@/modules/mappings/lifecycle";
import { isExportCandidate, type ExportCandidateState, type ExportSelection } from "./delta";

export type { ExportSelection } from "./delta";

/** One export row, already resolved to the values that go on the sheet. */
export interface ExportRow {
  hospdrugcode: string;
  productcat: string;
  tmtid: string;
  specprep: string;
  genericname: string;
  tradename: string;
  dfscode: string;
  dosageform: string;
  strength: string;
  content: string;
  unitprice: string;
  distributor: string;
  manufacturer: string;
  ised: string;
  ndc24: string;
  packsize: string;
  packprice: string;
  updateflag: string;
  datechange: string | null;
  dateupdate: string | null;
  dateeffective: string | null;
}

export interface ExportCandidate extends ExportCandidateState {
  row: ExportRow;
}

type ExportQueryDb = Pick<typeof db, "select">;

function text(value: string | null | undefined): string {
  return value?.toString().trim() ?? "";
}

/**
 * CONTENT is the pack description, not the dispensing unit alone.
 *
 * Checked against an approved DrugCat file: "1 mL ampoule" is contvalue "1" +
 * contunit "mL" + dispunit "ampoule", and a product with no content value is
 * just its dispensing unit ("tablet"). Emitting dispunit on its own dropped the
 * pack size from every injectable.
 */
function contentText(contentValue: string | null, contentUnit: string | null, dispensingUnit: string | null): string {
  return [contentValue, contentUnit, dispensingUnit].map(text).filter((part) => part !== "").join(" ");
}

/**
 * Builds the export set for a facility.
 *
 * Field sources follow docs/SPEC.md: GENERICNAME from the standard's
 * activeIngredient, TRADENAME from its tradeName, ISED from the normalised NLEM
 * value stored on the standard.
 *
 * Columns with no source stay empty rather than being filled from something
 * that merely looks similar. SPECPREP, DFSCODE and PACKSIZE have no TMT field
 * and are blank in the approved DrugCat files, so they carry only what a user
 * typed on the mapping screen.
 *
 * NDC24 comes from the Drug Catalog file alone. cdrug.drugcode24 is not a
 * substitute: the file has already been through the central system that
 * validates it, and JHCIS is not reliably right. No value in the file means no
 * value here. UNITPRICE still falls back to the JHCIS selling price, which is a
 * local fact TMT never carries.
 */
export async function buildExportCandidates(
  facilityId: string,
  selection: ExportSelection,
  database: ExportQueryDb = db,
  lockRows = false,
): Promise<ExportCandidate[]> {
  const latestCatalog = alias(drugCatalogRows, "latest_export_catalog");
  const latestImportId = sql<string>`(
    SELECT ${drugCatalogImports.id}
    FROM ${drugCatalogImports}
    WHERE ${drugCatalogImports.facilityId} = ${facilityId}
    ORDER BY ${drugCatalogImports.createdAt} DESC
    LIMIT 1
  )`;
  const everInCatalog = sql<boolean>`EXISTS (
    SELECT 1 FROM drug_catalog_rows export_catalog_history
    WHERE export_catalog_history.facility_id = ${sourceDrugs.facilityId}
      AND export_catalog_history.hospdrugcode = ${sourceDrugs.drugcode}
  )`;

  const query = database
    .select({
      facilityId: drugMappings.facilityId,
      mappingId: drugMappings.id,
      mappingSource: drugMappings.source,
      mappingUpdatedAt: drugMappings.updatedAt,
      acknowledgedMappingUpdatedAt: mappingReviewAcknowledgements.mappingUpdatedAt,
      acknowledgedCatalogPresent: mappingReviewAcknowledgements.catalogPresent,
      acknowledgedCatalogTmtid: mappingReviewAcknowledgements.catalogTmtid,
      checkpointFacilityId: mappingExportCheckpoints.facilityId,
      checkpointMappingId: mappingExportCheckpoints.mappingId,
      checkpointMappingUpdatedAt: mappingExportCheckpoints.mappingUpdatedAt,
      checkpointExportId: mappingExportCheckpoints.exportId,
      drugcode: sourceDrugs.drugcode,
      drugtype: sourceDrugs.drugtype,
      sell: sourceDrugs.sell,
      standardCode: drugMappings.standardCode,
      productCat: drugMappings.productCat,
      specPrep: drugMappings.specPrep,
      dfscode: drugMappings.dfscode,
      unitPrice: drugMappings.unitPrice,
      distributor: drugMappings.distributor,
      mappingIsed: drugMappings.ised,
      ndc24: drugMappings.ndc24,
      packsize: drugMappings.packsize,
      packPrice: drugMappings.packPrice,
      updateFlag: drugMappings.updateFlag,
      dateChange: drugMappings.dateChange,
      dateUpdate: drugMappings.dateUpdate,
      dateEffective: drugMappings.dateEffective,
      activeIngredient: standardProducts.activeIngredient,
      tradeName: standardProducts.tradeName,
      dosageForm: standardProducts.dosageForm,
      strength: standardProducts.strength,
      contentValue: standardProducts.contentValue,
      contentUnit: standardProducts.contentUnit,
      dispensingUnit: standardProducts.dispensingUnit,
      manufacturer: standardProducts.manufacturer,
      standardIsed: standardProducts.exportIsed,
      standardStatus: standardProducts.status,
      standardType: standardProducts.standardType,
      latestCatalogRowId: latestCatalog.id,
      latestCatalogTmtid: latestCatalog.tmtid,
      everInCatalog,
    })
    .from(drugMappings)
    .innerJoin(
      sourceDrugs,
      and(eq(sourceDrugs.id, drugMappings.sourceDrugId), eq(sourceDrugs.facilityId, drugMappings.facilityId)),
    )
    .leftJoin(standardProducts, eq(standardProducts.standardCode, drugMappings.standardCode))
    .leftJoin(
      mappingReviewAcknowledgements,
      and(
        eq(mappingReviewAcknowledgements.facilityId, drugMappings.facilityId),
        eq(mappingReviewAcknowledgements.mappingId, drugMappings.id),
      ),
    )
    .leftJoin(
      latestCatalog,
      and(
        eq(latestCatalog.importId, latestImportId),
        eq(latestCatalog.facilityId, drugMappings.facilityId),
        eq(latestCatalog.hospdrugcode, sourceDrugs.drugcode),
      ),
    )
    .leftJoin(
      mappingExportCheckpoints,
      and(
        eq(mappingExportCheckpoints.facilityId, drugMappings.facilityId),
        eq(mappingExportCheckpoints.mappingId, drugMappings.id),
      ),
    )
    .where(and(eq(drugMappings.facilityId, facilityId), eq(sourceDrugs.active, 1)))
    .orderBy(asc(sourceDrugs.drugcode));
  const rows = await (lockRows ? query.for("update") : query);

  return rows.flatMap((row) => {
    const lifecycle = classifyMappingLifecycle({
      active: true,
      mapping: { source: row.mappingSource, standardCode: row.standardCode, updatedAt: row.mappingUpdatedAt },
      inLatestCatalog: Boolean(row.latestCatalogRowId),
      latestCatalogTmtid: row.latestCatalogTmtid,
      everInCatalog: Boolean(row.everInCatalog),
      reviewAcknowledgement:
        row.acknowledgedMappingUpdatedAt && row.acknowledgedCatalogPresent !== null
          ? {
              mappingUpdatedAt: row.acknowledgedMappingUpdatedAt,
              catalogPresent: row.acknowledgedCatalogPresent,
              catalogTmtid: row.acknowledgedCatalogTmtid,
            }
          : null,
    });
    const expectedStandardType = row.drugtype === "01" ? "TMT" : row.drugtype === "10" ? "TTMT" : null;
    const candidate: ExportCandidateState = {
      facilityId: row.facilityId,
      mappingId: row.mappingId,
      mappingSource: row.mappingSource,
      mappingUpdatedAt: row.mappingUpdatedAt,
      checkpointExportId: row.checkpointExportId,
      status: lifecycle.status === "hidden" ? "needs_review" : lifecycle.status,
      standardValid: row.standardStatus === "active" && row.standardType === expectedStandardType,
    };
    const checkpoint =
      row.checkpointFacilityId && row.checkpointMappingId && row.checkpointMappingUpdatedAt
        ? {
            facilityId: row.checkpointFacilityId,
            mappingId: row.checkpointMappingId,
            mappingUpdatedAt: row.checkpointMappingUpdatedAt,
          }
        : null;
    if (!isExportCandidate(candidate, checkpoint, selection)) return [];

    return [{
      ...candidate,
      row: {
        hospdrugcode: text(row.drugcode),
        productcat: text(row.productCat),
        tmtid: text(row.standardCode),
        specprep: text(row.specPrep),
        genericname: text(row.activeIngredient),
        tradename: text(row.tradeName),
        dfscode: text(row.dfscode),
        dosageform: text(row.dosageForm),
        strength: text(row.strength),
        content: contentText(row.contentValue, row.contentUnit, row.dispensingUnit),
        unitprice: text(row.unitPrice) || text(row.sell),
        distributor: text(row.distributor),
        manufacturer: text(row.manufacturer),
        // Prefer the mapping's stored ISED; fall back to the standard's current value.
        ised: text(row.mappingIsed) || text(row.standardIsed),
        ndc24: text(row.ndc24),
        packsize: text(row.packsize),
        packprice: text(row.packPrice),
        updateflag: text(row.updateFlag),
        datechange: row.dateChange,
        dateupdate: row.dateUpdate,
        dateeffective: row.dateEffective,
      },
    }];
  });
}

export async function buildExportRows(facilityId: string, selection: ExportSelection): Promise<ExportRow[]> {
  return (await buildExportCandidates(facilityId, selection)).map((candidate) => candidate.row);
}
