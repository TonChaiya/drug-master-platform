import { and, asc, desc, eq, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { drugMappings, sourceDrugs, standardProducts } from "@/db/schema";

export type MappingStatusFilter = "all" | "mapped" | "pending";
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
  if (options.status === "mapped") conditions.push(sql`${drugMappings.id} IS NOT NULL`);
  if (options.status === "pending") conditions.push(isNull(drugMappings.id));

  const where = and(...conditions);

  const [counted] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(sourceDrugs)
    .leftJoin(drugMappings, eq(drugMappings.sourceDrugId, sourceDrugs.id))
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
    })
    .from(sourceDrugs)
    .leftJoin(drugMappings, eq(drugMappings.sourceDrugId, sourceDrugs.id))
    .leftJoin(standardProducts, eq(standardProducts.standardCode, drugMappings.standardCode))
    .where(where)
    .orderBy(sql`${drugMappings.id} IS NULL DESC`, asc(sourceDrugs.drugcode))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    rows: rows as WorklistRow[],
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
