import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ActiveStandardRelease } from "./active-release";

export interface TtmtSearchRow {
  code: string; fsn: string | null; activeIngredient: string | null; tradeName: string | null;
  manufacturer: string | null; registrationNumber: string | null; status: string; sourceVersion: string;
}

export async function searchTtmtStandards(pool: Pick<Pool, "query">, query: string, release?: ActiveStandardRelease): Promise<TtmtSearchRow[]> {
  const table = release ? "ttmt_dataset_products" : "ttmt_products";
  const normalized = query.trim().toLowerCase();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ttmtcode,fsn,activeingredient,tradename,manufacturer,registration_number,status,source_version
     FROM ${table} WHERE ${release ? "dataset_id=? AND " : ""}(ttmtcode LIKE ? OR normalized_generic LIKE ? OR normalized_trade LIKE ? OR normalized_manufacturer LIKE ? OR normalized_regno LIKE ?)
     ORDER BY ttmtcode LIMIT 30`,
    [...(release ? [release.ttmtDatasetId] : []), `${query.trim()}%`, `${normalized}%`, `${normalized}%`, `${normalized}%`, `${normalized}%`],
  );
  return rows.map((row) => ({
    code: String(row.ttmtcode), fsn: row.fsn === null ? null : String(row.fsn), activeIngredient: row.activeingredient === null ? null : String(row.activeingredient),
    tradeName: row.tradename === null ? null : String(row.tradename), manufacturer: row.manufacturer === null ? null : String(row.manufacturer),
    registrationNumber: row.registration_number === null ? null : String(row.registration_number), status: String(row.status), sourceVersion: String(row.source_version),
  }));
}
