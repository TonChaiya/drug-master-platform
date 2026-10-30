import { and, asc, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "@/db/client";
import { drugCatalogRows, drugMappings, sourceDrugs, standardProducts } from "@/db/schema";
import { latestImport } from "@/modules/catalog/service";
import { classifyMappingLifecycle, type MappingLifecycleStatus } from "./lifecycle";

export type MappingStatusFilter = "all" | "mapped" | "pending" | "needs_review";
export type DrugTypeFilter = "all" | "01" | "10";

export interface WorklistRow {
  sourceDrugId: string;
  drugcode: string;
  drugname: string | null;
  drugnamethai: string | null;
  druggenericname: string | null;
  drugtype: string;
  pack: string | null;
  sell: string | null;
  mappingId: string | null;
  standardCode: string | null;
  standardType: string | null;
  tradeName: string | null;
  activeIngredient: string | null;
  manufacturer: string | null;
  strength: string | null;
  dosageForm: string | null;
  updateFlag: string | null;
  mappingSource: string | null;
  mappedAt: Date | null;
  status: Exclude<MappingLifecycleStatus, "hidden">;
  statusReason: string | null;
  latestCatalogTmtid: string | null;
}

export interface Worklist {
  rows: WorklistRow[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * The mapping worklist. Unmapped rows sort first so the remaining work is
 * always at the top. Every query is scoped by facilityId from the session.
 */
export async function mappingWorklist(options: {
  facilityId: string;
  query?: string;
  status?: MappingStatusFilter;
  drugType?: DrugTypeFilter;
  page?: number;
  pageSize?: number;
}): Promise<Worklist> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 30, 1), 200);
  const page = Math.max(options.page ?? 1, 1);
  const snapshot = await latestImport(options.facilityId);
  const latestCatalog = alias(drugCatalogRows, "latest_catalog");
  const catalogHistory = db
    .select({
      facilityId: drugCatalogRows.facilityId,
      hospdrugcode: drugCatalogRows.hospdrugcode,
    })
    .from(drugCatalogRows)
    .where(eq(drugCatalogRows.facilityId, options.facilityId))
    .groupBy(drugCatalogRows.facilityId, drugCatalogRows.hospdrugcode)
    .as("catalog_history");
  const latestImportId = snapshot?.id ?? "";
  const everInCatalog = sql<boolean>`${catalogHistory.hospdrugcode} IS NOT NULL`;
  const needsReview = sql<boolean>`(
    (${latestCatalog.id} IS NULL AND ${everInCatalog})
    OR (
      ${latestCatalog.id} IS NOT NULL
      AND ${drugMappings.id} IS NOT NULL
      AND (${latestCatalog.tmtid} IS NULL OR ${latestCatalog.tmtid} <> ${drugMappings.standardCode})
    )
  )`;

  const conditions: SQL[] = [eq(sourceDrugs.facilityId, options.facilityId), eq(sourceDrugs.active, 1)];

  const trimmed = options.query?.trim() ?? "";
  if (trimmed.length >= 2) {
    const pattern = `%${trimmed}%`;
    const search = or(
      like(sourceDrugs.drugcode, pattern),
      like(sourceDrugs.drugname, pattern),
      like(sourceDrugs.drugnamethai, pattern),
      like(sourceDrugs.druggenericname, pattern),
    );
    if (search) conditions.push(search);
  }
  if (options.drugType === "01" || options.drugType === "10") {
    conditions.push(eq(sourceDrugs.drugtype, options.drugType));
  }
  if (options.status === "needs_review") conditions.push(needsReview);
  if (options.status === "mapped") conditions.push(sql`${drugMappings.id} IS NOT NULL AND NOT ${needsReview}`);
  if (options.status === "pending") conditions.push(sql`${drugMappings.id} IS NULL AND NOT ${needsReview}`);

  const where = and(...conditions);

  const [counted] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(sourceDrugs)
    .leftJoin(
      drugMappings,
      and(eq(drugMappings.sourceDrugId, sourceDrugs.id), eq(drugMappings.facilityId, sourceDrugs.facilityId)),
    )
    .leftJoin(
      latestCatalog,
      and(
        eq(latestCatalog.importId, latestImportId),
        eq(latestCatalog.facilityId, sourceDrugs.facilityId),
        eq(latestCatalog.hospdrugcode, sourceDrugs.drugcode),
      ),
    )
    .leftJoin(
      catalogHistory,
      and(
        eq(catalogHistory.facilityId, sourceDrugs.facilityId),
        eq(catalogHistory.hospdrugcode, sourceDrugs.drugcode),
      ),
    )
    .where(where);
  const total = Number(counted?.total ?? 0);

  const rows = await db
    .select({
      sourceDrugId: sourceDrugs.id,
      drugcode: sourceDrugs.drugcode,
      drugname: sourceDrugs.drugname,
      drugnamethai: sourceDrugs.drugnamethai,
      druggenericname: sourceDrugs.druggenericname,
      drugtype: sourceDrugs.drugtype,
      pack: sourceDrugs.pack,
      sell: sourceDrugs.sell,
      mappingId: drugMappings.id,
      standardCode: drugMappings.standardCode,
      updateFlag: drugMappings.updateFlag,
      mappingSource: drugMappings.source,
      mappedAt: drugMappings.mappedAt,
      standardType: standardProducts.standardType,
      tradeName: standardProducts.tradeName,
      activeIngredient: standardProducts.activeIngredient,
      manufacturer: standardProducts.manufacturer,
      strength: standardProducts.strength,
      dosageForm: standardProducts.dosageForm,
      latestCatalogRowId: latestCatalog.id,
      latestCatalogTmtid: latestCatalog.tmtid,
      everInCatalog,
    })
    .from(sourceDrugs)
    .leftJoin(
      drugMappings,
      and(eq(drugMappings.sourceDrugId, sourceDrugs.id), eq(drugMappings.facilityId, sourceDrugs.facilityId)),
    )
    .leftJoin(standardProducts, eq(standardProducts.standardCode, drugMappings.standardCode))
    .leftJoin(
      latestCatalog,
      and(
        eq(latestCatalog.importId, latestImportId),
        eq(latestCatalog.facilityId, sourceDrugs.facilityId),
        eq(latestCatalog.hospdrugcode, sourceDrugs.drugcode),
      ),
    )
    .leftJoin(
      catalogHistory,
      and(
        eq(catalogHistory.facilityId, sourceDrugs.facilityId),
        eq(catalogHistory.hospdrugcode, sourceDrugs.drugcode),
      ),
    )
    .where(where)
    .orderBy(sql`CASE WHEN ${needsReview} THEN 0 WHEN ${drugMappings.id} IS NULL THEN 1 ELSE 2 END`, asc(sourceDrugs.drugcode))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const classified = rows.map(({ latestCatalogRowId, everInCatalog: wasEverInCatalog, ...row }) => {
    const lifecycle = classifyMappingLifecycle({
      active: true,
      mapping:
        row.mappingId && row.standardCode
          ? { source: row.mappingSource ?? "manual", standardCode: row.standardCode }
          : null,
      inLatestCatalog: Boolean(latestCatalogRowId),
      latestCatalogTmtid: row.latestCatalogTmtid,
      everInCatalog: Boolean(wasEverInCatalog),
    });
    return { ...row, status: lifecycle.status as WorklistRow["status"], statusReason: lifecycle.reason };
  });

  return {
    rows: classified,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function mappingHistory(facilityId: string, limit = 30) {
  return db
    .select({
      mappingId: drugMappings.id,
      drugcode: sourceDrugs.drugcode,
      drugname: sourceDrugs.drugname,
      standardCode: drugMappings.standardCode,
      updateFlag: drugMappings.updateFlag,
      source: drugMappings.source,
      updatedAt: drugMappings.updatedAt,
      tradeName: standardProducts.tradeName,
    })
    .from(drugMappings)
    .innerJoin(sourceDrugs, eq(sourceDrugs.id, drugMappings.sourceDrugId))
    .leftJoin(standardProducts, eq(standardProducts.standardCode, drugMappings.standardCode))
    .where(eq(drugMappings.facilityId, facilityId))
    .orderBy(desc(drugMappings.updatedAt))
    .limit(limit);
}
