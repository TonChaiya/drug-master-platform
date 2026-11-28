import { sql, type SQL } from "drizzle-orm";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type TmtAssurance = "verified" | "validated_unverified";
export type TmtPointer = { datasetId: string | null; generation: number; assurance: TmtAssurance | null; coverageThrough: string | null };

export function isTmtPointerUnavailable(error: unknown): boolean {
  return error instanceof Error && (error.message === "TMT_POINTER_MISSING" || error.message === "TMT_POINTER_EVIDENCE_INVALID");
}
export const TMT_POINTER_SQL = `SELECT p.dataset_id,p.generation,d.source,d.state,d.content_hash,a.manifest_hash,a.assurance,
  DATE_FORMAT(a.coverage_through,'%Y-%m-%d') AS coverage_through
  FROM tmt_active_dataset p LEFT JOIN standard_datasets d ON d.id=p.dataset_id
  LEFT JOIN tmt_candidate_acceptances a ON a.dataset_id=p.dataset_id WHERE p.singleton_id=1`;

function parsePointer(row: RowDataPacket | undefined): TmtPointer {
  if (!row || !Number.isSafeInteger(Number(row.generation))) throw new Error("TMT_POINTER_MISSING");
  if (row.dataset_id === null) return { datasetId: null, generation: Number(row.generation), assurance: null, coverageThrough: null };
  if (row.source !== "TMT" || row.state !== "validated" || typeof row.manifest_hash !== "string"
    || !/^[0-9a-f]{64}$/.test(row.manifest_hash) || row.manifest_hash !== row.content_hash
    || (row.assurance !== "verified" && row.assurance !== "validated_unverified") || typeof row.coverage_through !== "string") {
    throw new Error("TMT_POINTER_EVIDENCE_INVALID");
  }
  return { datasetId: String(row.dataset_id), generation: Number(row.generation), assurance: row.assurance, coverageThrough: row.coverage_through };
}

export async function readTmtPointer(executor: Pick<Pool | PoolConnection, "query">, lock = false): Promise<TmtPointer> {
  if (lock) await executor.query("SELECT singleton_id FROM tmt_active_dataset WHERE singleton_id=1 FOR UPDATE");
  const [rows] = await executor.query<RowDataPacket[]>(TMT_POINTER_SQL + (lock ? " FOR UPDATE" : ""));
  return parsePointer(rows[0]);
}

export async function readLockedTmtPointer(executor: { execute(query: SQL): Promise<unknown> }): Promise<TmtPointer> {
  await executor.execute(sql`SELECT singleton_id FROM tmt_active_dataset WHERE singleton_id=1 FOR UPDATE`);
  const response = await executor.execute(sql.raw(TMT_POINTER_SQL + " FOR UPDATE"));
  const rows = Array.isArray(response) && Array.isArray(response[0]) ? response[0] as RowDataPacket[] : [];
  return parsePointer(rows[0]);
}
