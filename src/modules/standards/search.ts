import { and, asc, eq, like, or, sql, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { db } from "@/db/client";
import { standardProducts } from "@/db/schema";
import { normalizeRegistrationNumber, normalizeSearchText } from "./normalize";

export const MIN_SEARCH_LENGTH = 2;

export interface StandardSearchFilters {
  standardType: "TMT" | "TTMT";
  code?: string;
  tradeName?: string;
  genericName?: string;
  manufacturer?: string;
  registrationNumber?: string;
  limit?: number;
}

export interface StandardSearchRow {
  standardCode: string;
  standardType: string;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  dispensingUnit: string | null;
  tradeName: string | null;
  manufacturer: string | null;
  registrationNumber: string | null;
  exportIsed: string | null;
  fsn: string | null;
}

/**
 * Five independent filters, all optional and combined with AND. Manual mapping
 * may only choose active products, so `status = 'active'` is not a filter the
 * caller can turn off (docs/SPEC.md).
 *
 * Each text filter needs at least two characters; a request that supplies only
 * shorter fragments returns nothing rather than scanning the whole catalogue.
 */
export async function searchStandards(filters: StandardSearchFilters): Promise<StandardSearchRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const conditions: SQL[] = [eq(standardProducts.standardType, filters.standardType), eq(standardProducts.status, "active")];

  let applied = 0;
  let tooShort = false;

  const addText = (value: string | undefined, column: MySqlColumn, normalizer = normalizeSearchText): void => {
    const raw = value?.trim();
    if (!raw) return;
    if (raw.length < MIN_SEARCH_LENGTH) {
      tooShort = true;
      return;
    }
    const normalized = normalizer(raw);
    if (!normalized) return;
    conditions.push(like(column, `%${escapeLike(normalized)}%`));
    applied += 1;
  };

  const code = filters.code?.trim();
  if (code) {
    if (code.length < MIN_SEARCH_LENGTH) {
      tooShort = true;
    } else {
      const codeMatch = or(eq(standardProducts.standardCode, code), like(standardProducts.standardCode, `${escapeLike(code)}%`));
      if (codeMatch) conditions.push(codeMatch);
      applied += 1;
    }
  }

  addText(filters.tradeName, standardProducts.normalizedTrade);
  addText(filters.genericName, standardProducts.normalizedGeneric);
  addText(filters.manufacturer, standardProducts.normalizedManufacturer);
  addText(filters.registrationNumber, standardProducts.normalizedRegno, normalizeRegistrationNumber);

  // No usable filter: return nothing rather than the entire catalogue.
  if (applied === 0 || tooShort) return [];

  return db
    .select({
      standardCode: standardProducts.standardCode,
      standardType: standardProducts.standardType,
      activeIngredient: standardProducts.activeIngredient,
      strength: standardProducts.strength,
      dosageForm: standardProducts.dosageForm,
      dispensingUnit: standardProducts.dispensingUnit,
      tradeName: standardProducts.tradeName,
      manufacturer: standardProducts.manufacturer,
      registrationNumber: standardProducts.registrationNumber,
      exportIsed: standardProducts.exportIsed,
      fsn: standardProducts.fsn,
    })
    .from(standardProducts)
    .where(and(...conditions))
    .orderBy(asc(standardProducts.normalizedTrade), asc(standardProducts.standardCode))
    .limit(limit);
}

/** `%` and `_` are wildcards in LIKE and must not come from user input. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function standardCounts(): Promise<{ tmt: number; ttmt: number }> {
  const [row] = await db
    .select({
      tmt: sql<number>`SUM(CASE WHEN ${standardProducts.standardType} = 'TMT' AND ${standardProducts.status} = 'active' THEN 1 ELSE 0 END)`,
      ttmt: sql<number>`SUM(CASE WHEN ${standardProducts.standardType} = 'TTMT' AND ${standardProducts.status} = 'active' THEN 1 ELSE 0 END)`,
    })
    .from(standardProducts);
  return { tmt: Number(row?.tmt ?? 0), ttmt: Number(row?.ttmt ?? 0) };
}
