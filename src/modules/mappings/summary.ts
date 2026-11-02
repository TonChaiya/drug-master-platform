import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  drugCatalogImports,
  drugCatalogRows,
  drugMappings,
  facilities,
  mappingReviewAcknowledgements,
  sourceDrugs,
  standardProducts,
} from "@/db/schema";
import { classifyMappingLifecycle, type MappingLifecycleInput } from "./lifecycle";

export interface MappingLifecycleSummaryInput {
  facilityId: string;
  drugtype: string;
  lifecycle: MappingLifecycleInput;
  standardStatus: string | null;
  standardType: string | null;
  mappingUpdatedAt: Date | null;
}

export interface MappingLifecycleSummary {
  facilityId: string;
  sourceTotal: number;
  mappedTotal: number;
  pendingTotal: number;
  needsReviewTotal: number;
  exportReadyTotal: number;
  type01: number;
  type10: number;
  lastMappedAt: Date | null;
}

type MappingSummaryDb = Pick<typeof db, "select">;

export function emptyMappingLifecycleSummary(facilityId: string): MappingLifecycleSummary {
  return {
    facilityId,
    sourceTotal: 0,
    mappedTotal: 0,
    pendingTotal: 0,
    needsReviewTotal: 0,
    exportReadyTotal: 0,
    type01: 0,
    type10: 0,
    lastMappedAt: null,
  };
}

export function summarizeMappingLifecycleInputs(
  rows: MappingLifecycleSummaryInput[],
): Map<string, MappingLifecycleSummary> {
  const summaries = new Map<string, MappingLifecycleSummary>();
  for (const row of rows) {
    if (!row.lifecycle.active) {
      if (!summaries.has(row.facilityId)) summaries.set(row.facilityId, emptyMappingLifecycleSummary(row.facilityId));
      continue;
    }
    const summary = summaries.get(row.facilityId) ?? emptyMappingLifecycleSummary(row.facilityId);
    summaries.set(row.facilityId, summary);
    summary.sourceTotal += 1;
    if (row.drugtype === "01") summary.type01 += 1;
    if (row.drugtype === "10") summary.type10 += 1;

    const lifecycle = classifyMappingLifecycle(row.lifecycle);
    if (lifecycle.status === "mapped") {
      summary.mappedTotal += 1;
      const expectedStandardType = row.drugtype === "01" ? "TMT" : row.drugtype === "10" ? "TTMT" : null;
      if (row.standardStatus === "active" && row.standardType === expectedStandardType) summary.exportReadyTotal += 1;
    } else if (lifecycle.status === "needs_review") {
      summary.needsReviewTotal += 1;
    } else if (lifecycle.status === "pending") {
      summary.pendingTotal += 1;
    }
    if (row.mappingUpdatedAt && (!summary.lastMappedAt || row.mappingUpdatedAt > summary.lastMappedAt)) {
      summary.lastMappedAt = row.mappingUpdatedAt;
    }
  }
  return summaries;
}

/**
 * One bounded-column batch for all active source drugs, then the canonical
 * TypeScript lifecycle classifier. This deliberately favors one lifecycle
 * truth over a second SQL implementation. If fleet volume outgrows one
 * serverless response (roughly hundreds of thousands of active drugs), move
 * this same classification to a materialized summary rather than copying it.
 */
export async function mappingLifecycleSummaries(
  facilityId?: string,
  database: MappingSummaryDb = db,
): Promise<Map<string, MappingLifecycleSummary>> {
  const importScope = facilityId
    ? eq(drugCatalogImports.facilityId, facilityId)
    : eq(facilities.status, "active");
  const rankedImports = database
    .select({
      id: drugCatalogImports.id,
      facilityId: drugCatalogImports.facilityId,
      rank: sql<number>`ROW_NUMBER() OVER (
        PARTITION BY ${drugCatalogImports.facilityId}
        ORDER BY ${drugCatalogImports.createdAt} DESC
      )`.as("snapshot_rank"),
    })
    .from(drugCatalogImports)
    .innerJoin(facilities, eq(facilities.id, drugCatalogImports.facilityId))
    .where(importScope)
    .as("ranked_catalog_imports");
  const latestImports = await database
    .select({ id: rankedImports.id, facilityId: rankedImports.facilityId })
    .from(rankedImports)
    .where(eq(rankedImports.rank, 1));

  const sourceScope = facilityId
    ? and(eq(sourceDrugs.active, 1), eq(sourceDrugs.facilityId, facilityId))
    : and(eq(sourceDrugs.active, 1), eq(facilities.status, "active"));
  const historyScope = facilityId ? eq(drugCatalogRows.facilityId, facilityId) : eq(facilities.status, "active");
  const catalogHistory = database
    .select({ facilityId: drugCatalogRows.facilityId, hospdrugcode: drugCatalogRows.hospdrugcode })
    .from(drugCatalogRows)
    .innerJoin(facilities, eq(facilities.id, drugCatalogRows.facilityId))
    .where(historyScope)
    .groupBy(drugCatalogRows.facilityId, drugCatalogRows.hospdrugcode)
    .as("summary_catalog_history");

  const latestImportIds = latestImports.map((row) => row.id);
  const [sourceRows, latestCatalogRows] = await Promise.all([
    database
      .select({
        facilityId: sourceDrugs.facilityId,
        drugcode: sourceDrugs.drugcode,
        drugtype: sourceDrugs.drugtype,
        mappingId: drugMappings.id,
        mappingSource: drugMappings.source,
        standardCode: drugMappings.standardCode,
        mappingUpdatedAt: drugMappings.updatedAt,
        acknowledgedMappingUpdatedAt: mappingReviewAcknowledgements.mappingUpdatedAt,
        acknowledgedCatalogPresent: mappingReviewAcknowledgements.catalogPresent,
        acknowledgedCatalogTmtid: mappingReviewAcknowledgements.catalogTmtid,
        everInCatalog: sql<boolean>`${catalogHistory.hospdrugcode} IS NOT NULL`,
        standardStatus: standardProducts.status,
        standardType: standardProducts.standardType,
      })
      .from(sourceDrugs)
      .innerJoin(facilities, eq(facilities.id, sourceDrugs.facilityId))
      .leftJoin(
        drugMappings,
        and(eq(drugMappings.sourceDrugId, sourceDrugs.id), eq(drugMappings.facilityId, sourceDrugs.facilityId)),
      )
      .leftJoin(
        mappingReviewAcknowledgements,
        and(
          eq(mappingReviewAcknowledgements.mappingId, drugMappings.id),
          eq(mappingReviewAcknowledgements.facilityId, sourceDrugs.facilityId),
        ),
      )
      .leftJoin(standardProducts, eq(standardProducts.standardCode, drugMappings.standardCode))
      .leftJoin(
        catalogHistory,
        and(
          eq(catalogHistory.facilityId, sourceDrugs.facilityId),
          eq(catalogHistory.hospdrugcode, sourceDrugs.drugcode),
        ),
      )
      .where(sourceScope),
    latestImportIds.length === 0
      ? Promise.resolve([])
      : database
          .select({
            importId: drugCatalogRows.importId,
            facilityId: drugCatalogRows.facilityId,
            hospdrugcode: drugCatalogRows.hospdrugcode,
            tmtid: drugCatalogRows.tmtid,
          })
          .from(drugCatalogRows)
          .where(inArray(drugCatalogRows.importId, latestImportIds)),
  ]);

  const latestCatalogByDrug = new Map(
    latestCatalogRows.map((row) => [`${row.facilityId}\u0000${row.hospdrugcode}`, row]),
  );
  return summarizeMappingLifecycleInputs(
    sourceRows.map((row) => {
      const latest = latestCatalogByDrug.get(`${row.facilityId}\u0000${row.drugcode}`);
      return {
        facilityId: row.facilityId,
        drugtype: row.drugtype,
        lifecycle: {
          active: true,
          mapping:
            row.mappingId && row.standardCode && row.mappingUpdatedAt
              ? { source: row.mappingSource ?? "manual", standardCode: row.standardCode, updatedAt: row.mappingUpdatedAt }
              : null,
          inLatestCatalog: Boolean(latest),
          latestCatalogTmtid: latest?.tmtid ?? null,
          everInCatalog: Boolean(row.everInCatalog),
          reviewAcknowledgement:
            row.acknowledgedMappingUpdatedAt && row.acknowledgedCatalogPresent !== null
              ? {
                  mappingUpdatedAt: row.acknowledgedMappingUpdatedAt,
                  catalogPresent: row.acknowledgedCatalogPresent,
                  catalogTmtid: row.acknowledgedCatalogTmtid,
                }
              : null,
        },
        standardStatus: row.standardStatus,
        standardType: row.standardType,
        mappingUpdatedAt: row.mappingUpdatedAt,
      };
    }),
  );
}
