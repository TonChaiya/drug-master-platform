import { and, asc, count, eq, like, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "@/db/client";
import {
  drugCatalogRows,
  drugMappings,
  mappingReviewAcknowledgements,
  sourceDrugs,
  tmtConcept,
  tmtMastertmt,
  ttmtImports,
  ttmtProducts,
} from "@/db/schema";
import { latestImport } from "@/modules/catalog/service";
import { classifyMappingLifecycle, type MappingLifecycleStatus } from "./lifecycle";
import { loadMappedStandardsV2, mappingV2IdentityKey, type MappingV2Identity } from "./v2-consumer";

export type V2WorklistStatusFilter = "all" | "mapped" | "pending" | "needs_review";
export type V2WorklistDrugTypeFilter = "all" | "01" | "10";

export interface V2WorklistRow {
  sourceDrugId: string;
  drugcode: string;
  drugname: string | null;
  drugnamethai: string | null;
  druggenericname: string | null;
  drugtype: string;
  mappingId: string | null;
  standardSource: "TMT" | "TTMT" | null;
  standardCode: string | null;
  standardLevel: string | null;
  mappingSource: string | null;
  updateFlag: string | null;
  status: Exclude<MappingLifecycleStatus, "hidden">;
  statusReason: string | null;
  standardName: string | null;
  standardTradeName: string | null;
  standardManufacturer: string | null;
  standardEligible: boolean | null;
}

export interface V2WorklistResult {
  rows: V2WorklistRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

function identityFrom(row: {
  mappingId: string | null;
  standardSource: string | null;
  standardCode: string | null;
  standardLevel: string | null;
  productCat: string | null;
}): MappingV2Identity | null {
  if (!row.mappingId || !row.standardCode || !row.standardLevel) return null;
  if (row.standardSource !== "TMT" && row.standardSource !== "TTMT") return null;
  return { source: row.standardSource, code: row.standardCode, level: row.standardLevel, productCat: row.productCat ?? "" };
}

/**
 * Paginated source-aware worklist. Lifecycle predicates are expressed in SQL
 * for pagination, while the canonical TypeScript classifier supplies the row
 * label/reason after the visible mapping identities are batch-resolved.
 */
export async function mappingWorklistV2(options: {
  facilityId: string;
  query?: string;
  status?: V2WorklistStatusFilter;
  drugType?: V2WorklistDrugTypeFilter;
  page?: number;
  pageSize?: number;
}): Promise<V2WorklistResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 30, 1), 200);
  const page = Math.max(options.page ?? 1, 1);
  const status = options.status ?? "pending";
  const drugType = options.drugType ?? "all";
  const latest = await latestImport(options.facilityId);
  const latestCatalog = alias(drugCatalogRows, "v2_worklist_latest_catalog");
  const history = db
    .select({ facilityId: drugCatalogRows.facilityId, hospdrugcode: drugCatalogRows.hospdrugcode })
    .from(drugCatalogRows)
    .where(eq(drugCatalogRows.facilityId, options.facilityId))
    .groupBy(drugCatalogRows.facilityId, drugCatalogRows.hospdrugcode)
    .as("v2_worklist_catalog_history");
  const latestJoin: SQL = latest
    ? and(
        eq(latestCatalog.importId, latest.id),
        eq(latestCatalog.facilityId, sourceDrugs.facilityId),
        eq(latestCatalog.hospdrugcode, sourceDrugs.drugcode),
      )!
    : sql`1 = 0`;
  const acknowledgementMatches = sql<boolean>`(
    ${mappingReviewAcknowledgements.mappingId} IS NOT NULL
    AND ${mappingReviewAcknowledgements.mappingUpdatedAt} = ${drugMappings.updatedAt}
    AND ${mappingReviewAcknowledgements.catalogPresent} = (${latestCatalog.id} IS NOT NULL)
    AND ${mappingReviewAcknowledgements.catalogTmtid} <=> ${latestCatalog.tmtid}
  )`;
  const standardValid = sql<boolean>`(
    (${drugMappings.standardSource} = 'TMT'
      AND ${drugMappings.standardLevel} = 'tpu'
      AND ${drugMappings.productCat} = '1'
      AND ${tmtConcept.levelName} = 'tpu'
      AND ${tmtMastertmt.status} = 0)
    OR (${drugMappings.standardSource} = 'TTMT'
      AND ${drugMappings.standardLevel} = 'product'
      AND ${drugMappings.productCat} = '3'
      AND ${ttmtProducts.status} = 'active'
      AND ${ttmtImports.status} = 'succeeded')
  )`;
  const needsReview = sql<boolean>`(
    (${drugMappings.id} IS NOT NULL AND NOT (${standardValid}))
    OR (${latestCatalog.id} IS NULL AND ${history.hospdrugcode} IS NOT NULL AND NOT (${acknowledgementMatches}))
    OR (${drugMappings.id} IS NOT NULL AND ${latestCatalog.id} IS NOT NULL AND ${latestCatalog.tmtid} IS NULL AND NOT (${acknowledgementMatches}))
    OR (${drugMappings.id} IS NOT NULL AND ${latestCatalog.tmtid} IS NOT NULL AND ${latestCatalog.tmtid} <> ${drugMappings.standardCode} AND NOT (${acknowledgementMatches}))
  )`;
  const conditions: SQL[] = [
    eq(sourceDrugs.facilityId, options.facilityId),
    eq(sourceDrugs.active, 1),
  ];
  if (drugType !== "all") conditions.push(eq(sourceDrugs.drugtype, drugType));
  if (options.query?.trim()) {
    const term = `%${options.query.trim()}%`;
    conditions.push(or(
      like(sourceDrugs.drugcode, term),
      like(sourceDrugs.drugname, term),
      like(sourceDrugs.drugnamethai, term),
      like(sourceDrugs.druggenericname, term),
    )!);
  }
  if (status === "needs_review") conditions.push(needsReview);
  if (status === "pending") conditions.push(sql`${drugMappings.id} IS NULL AND NOT (${needsReview})`);
  if (status === "mapped") conditions.push(sql`${drugMappings.id} IS NOT NULL AND NOT (${needsReview})`);
  const where = and(...conditions);

  const [counted] = await db
    .select({ total: count().as("total") })
    .from(sourceDrugs)
    .leftJoin(drugMappings, and(eq(drugMappings.sourceDrugId, sourceDrugs.id), eq(drugMappings.facilityId, sourceDrugs.facilityId)))
    .leftJoin(mappingReviewAcknowledgements, and(eq(mappingReviewAcknowledgements.mappingId, drugMappings.id), eq(mappingReviewAcknowledgements.facilityId, sourceDrugs.facilityId)))
    .leftJoin(latestCatalog, latestJoin)
    .leftJoin(history, and(eq(history.facilityId, sourceDrugs.facilityId), eq(history.hospdrugcode, sourceDrugs.drugcode)))
    .leftJoin(tmtConcept, sql`${drugMappings.standardSource} = 'TMT' AND ${tmtConcept.tmtid} = CAST(${drugMappings.standardCode} AS UNSIGNED)`)
    .leftJoin(tmtMastertmt, eq(tmtMastertmt.tpucode, tmtConcept.tmtid))
    .leftJoin(ttmtProducts, and(eq(drugMappings.standardSource, "TTMT"), eq(ttmtProducts.ttmtcode, drugMappings.standardCode)))
    .leftJoin(ttmtImports, eq(ttmtImports.id, ttmtProducts.sourceImportId))
    .where(where);
  const rows = await db.select({
    sourceDrugId: sourceDrugs.id,
    drugcode: sourceDrugs.drugcode,
    drugname: sourceDrugs.drugname,
    drugnamethai: sourceDrugs.drugnamethai,
    druggenericname: sourceDrugs.druggenericname,
    drugtype: sourceDrugs.drugtype,
    mappingId: drugMappings.id,
    standardSource: drugMappings.standardSource,
    standardCode: drugMappings.standardCode,
    standardLevel: drugMappings.standardLevel,
    productCat: drugMappings.productCat,
    mappingSource: drugMappings.source,
    updateFlag: drugMappings.updateFlag,
    mappingUpdatedAt: drugMappings.updatedAt,
    acknowledgedMappingUpdatedAt: mappingReviewAcknowledgements.mappingUpdatedAt,
    acknowledgedCatalogPresent: mappingReviewAcknowledgements.catalogPresent,
    acknowledgedCatalogTmtid: mappingReviewAcknowledgements.catalogTmtid,
    latestCatalogRowId: latestCatalog.id,
    latestCatalogTmtid: latestCatalog.tmtid,
    everInCatalog: sql<boolean>`${history.hospdrugcode} IS NOT NULL`,
  })
    .from(sourceDrugs)
    .leftJoin(drugMappings, and(eq(drugMappings.sourceDrugId, sourceDrugs.id), eq(drugMappings.facilityId, sourceDrugs.facilityId)))
    .leftJoin(mappingReviewAcknowledgements, and(eq(mappingReviewAcknowledgements.mappingId, drugMappings.id), eq(mappingReviewAcknowledgements.facilityId, sourceDrugs.facilityId)))
    .leftJoin(latestCatalog, latestJoin)
    .leftJoin(history, and(eq(history.facilityId, sourceDrugs.facilityId), eq(history.hospdrugcode, sourceDrugs.drugcode)))
    .leftJoin(tmtConcept, sql`${drugMappings.standardSource} = 'TMT' AND ${tmtConcept.tmtid} = CAST(${drugMappings.standardCode} AS UNSIGNED)`)
    .leftJoin(tmtMastertmt, eq(tmtMastertmt.tpucode, tmtConcept.tmtid))
    .leftJoin(ttmtProducts, and(eq(drugMappings.standardSource, "TTMT"), eq(ttmtProducts.ttmtcode, drugMappings.standardCode)))
    .leftJoin(ttmtImports, eq(ttmtImports.id, ttmtProducts.sourceImportId))
    .where(where)
    .orderBy(sql`CASE WHEN ${needsReview} THEN 0 WHEN ${drugMappings.id} IS NULL THEN 1 ELSE 2 END`, asc(sourceDrugs.drugcode))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const identities = rows.flatMap((row) => {
    const identity = identityFrom(row);
    return identity ? [identity] : [];
  });
  const standards = await loadMappedStandardsV2(identities);
  const classified = rows.map((row) => {
    const identity = identityFrom(row);
    const standard = identity ? standards.get(mappingV2IdentityKey(identity)) : null;
    const lifecycle = classifyMappingLifecycle({
      active: true,
      mapping: row.mappingId && row.standardCode && row.mappingUpdatedAt
        ? { source: row.mappingSource ?? "manual", standardCode: row.standardCode, standardSource: row.standardSource, standardLevel: row.standardLevel, updatedAt: row.mappingUpdatedAt }
        : null,
      standardValid: row.mappingId ? standard?.eligible ?? false : undefined,
      inLatestCatalog: Boolean(row.latestCatalogRowId),
      latestCatalogTmtid: row.latestCatalogTmtid,
      everInCatalog: Boolean(row.everInCatalog),
      reviewAcknowledgement: row.acknowledgedMappingUpdatedAt && row.acknowledgedCatalogPresent !== null
        ? { mappingUpdatedAt: row.acknowledgedMappingUpdatedAt, catalogPresent: row.acknowledgedCatalogPresent, catalogTmtid: row.acknowledgedCatalogTmtid }
        : null,
    });
    return {
      sourceDrugId: row.sourceDrugId,
      drugcode: row.drugcode,
      drugname: row.drugname,
      drugnamethai: row.drugnamethai,
      druggenericname: row.druggenericname,
      drugtype: row.drugtype,
      mappingId: row.mappingId,
      standardSource: row.standardSource === "TMT" || row.standardSource === "TTMT" ? row.standardSource : null,
      standardCode: row.standardCode,
      standardLevel: row.standardLevel,
      mappingSource: row.mappingSource,
      updateFlag: row.updateFlag,
      status: lifecycle.status as Exclude<MappingLifecycleStatus, "hidden">,
      statusReason: lifecycle.reason,
      standardName: standard?.fsn ?? null,
      standardTradeName: standard?.tradeName ?? null,
      standardManufacturer: standard?.manufacturer ?? null,
      standardEligible: row.mappingId ? standard?.eligible ?? false : null,
    } satisfies V2WorklistRow;
  });
  const total = Number(counted?.total ?? 0);
  return { rows: classified, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
