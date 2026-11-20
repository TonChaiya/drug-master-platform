import type { Pool, RowDataPacket } from "mysql2/promise";
import { normalizeRegistrationNumber, normalizeSearchText } from "./normalize";
import type { ActiveStandardRelease } from "./active-release";

export interface TtmtSearchRow {
  code: string; fsn: string | null; activeIngredient: string | null; tradeName: string | null;
  manufacturer: string | null; registrationNumber: string | null; status: string; sourceVersion: string;
}

export interface TtmtSearchFilters {
  query?: string;
  code?: string;
  tradeName?: string;
  genericName?: string;
  manufacturer?: string;
  registrationNumber?: string;
  limit?: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function searchTtmtStandards(pool: Pick<Pool, "query">, filters: TtmtSearchFilters, release?: ActiveStandardRelease): Promise<TtmtSearchRow[]> {
  const conditions: string[] = [];
  const parameters: unknown[] = [];
  if (release) { conditions.push("p.dataset_id=?"); parameters.push(release.ttmtDatasetId); }
  const values = {
    code: filters.code?.trim(),
    tradeName: normalizeSearchText(filters.tradeName),
    genericName: normalizeSearchText(filters.genericName),
    manufacturer: normalizeSearchText(filters.manufacturer),
    registrationNumber: normalizeRegistrationNumber(filters.registrationNumber),
  };
  const query = filters.query?.trim();
  if (query) {
    const normalized = normalizeSearchText(query);
    const predicates = ["p.ttmtcode LIKE ?"];
    parameters.push(`${escapeLike(query)}%`);
    if (normalized) {
      predicates.push("p.normalized_generic LIKE ?", "p.normalized_trade LIKE ?", "p.normalized_manufacturer LIKE ?", "p.normalized_regno LIKE ?");
      parameters.push(...Array(4).fill(`${escapeLike(normalized)}%`));
    }
    conditions.push(`(${predicates.join(" OR ")})`);
  }
  for (const [key, column] of [
    ["code", "p.ttmtcode"],
    ["tradeName", "p.normalized_trade"],
    ["genericName", "p.normalized_generic"],
    ["manufacturer", "p.normalized_manufacturer"],
    ["registrationNumber", "p.normalized_regno"],
  ] as const) {
    const value = values[key];
    if (!value) continue;
    conditions.push(`${column} LIKE ?`);
    parameters.push(`${escapeLike(value)}%`);
  }
  if (conditions.length === (release ? 1 : 0)) return [];
  const source = release
    ? "ttmt_dataset_products p"
    : "ttmt_products p INNER JOIN ttmt_imports i ON i.id=p.source_import_id AND i.status='succeeded'";
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.ttmtcode,p.fsn,p.activeingredient,p.tradename,p.manufacturer,p.registration_number,p.status,p.source_version
     FROM ${source} WHERE ${conditions.join(" AND ")} ORDER BY p.ttmtcode LIMIT ?`,
    [...parameters, limit],
  );
  return rows.map((row) => ({
    code: String(row.ttmtcode), fsn: row.fsn === null ? null : String(row.fsn), activeIngredient: row.activeingredient === null ? null : String(row.activeingredient),
    tradeName: row.tradename === null ? null : String(row.tradename), manufacturer: row.manufacturer === null ? null : String(row.manufacturer),
    registrationNumber: row.registration_number === null ? null : String(row.registration_number), status: String(row.status), sourceVersion: String(row.source_version),
  }));
}
