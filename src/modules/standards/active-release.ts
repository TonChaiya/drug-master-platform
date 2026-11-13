import type { Pool, RowDataPacket } from "mysql2/promise";
import { sql, type SQL } from "drizzle-orm";

export const ACTIVE_STANDARD_RELEASE_POINTER_KEY = "active-standard-release";

export interface ActiveStandardRelease {
  releaseId: string;
  tmtDatasetId: string;
  ttmtDatasetId: string;
}

export class ActiveStandardReleaseError extends Error {
  readonly code = "ACTIVE_STANDARD_RELEASE_UNAVAILABLE";
}

type ActiveReleaseRow = RowDataPacket & {
  release_id: string;
  tmt_dataset_id: string;
  ttmt_dataset_id: string;
  release_state: string;
  approved_at: Date | null;
  tmt_state: string;
  tmt_source: string;
  ttmt_state: string;
  ttmt_source: string;
  validation_status: string | null;
};

function validatedRelease(row: ActiveReleaseRow | undefined): ActiveStandardRelease {
  if (
    !row ||
    row.release_state !== "approved" ||
    row.approved_at === null ||
    row.tmt_state !== "validated" ||
    row.tmt_source !== "TMT" ||
    row.ttmt_state !== "validated" ||
    row.ttmt_source !== "TTMT" ||
    row.validation_status !== "passed"
  ) {
    throw new ActiveStandardReleaseError("No validated approved active standard release");
  }
  return { releaseId: String(row.release_id), tmtDatasetId: String(row.tmt_dataset_id), ttmtDatasetId: String(row.ttmt_dataset_id) };
}

export async function readActiveStandardRelease(pool: Pick<Pool, "query">, lockPointer = false): Promise<ActiveStandardRelease> {
  const [rows] = await pool.query<ActiveReleaseRow[]>(
    `SELECT r.id AS release_id,r.tmt_dataset_id,r.ttmt_dataset_id,r.state AS release_state,r.approved_at,
      t.state AS tmt_state,t.source AS tmt_source,u.state AS ttmt_state,u.source AS ttmt_source,v.status AS validation_status
     FROM standard_dataset_pointers p
     INNER JOIN standard_releases r ON r.id=p.active_release_id
     INNER JOIN standard_datasets t ON t.id=r.tmt_dataset_id
     INNER JOIN standard_datasets u ON u.id=r.ttmt_dataset_id
     LEFT JOIN tmt_run_validations v ON v.run_id=r.validation_run_id
     WHERE p.pointer_key=? LIMIT 1${lockPointer ? " FOR UPDATE" : ""}`,
    [ACTIVE_STANDARD_RELEASE_POINTER_KEY],
  );
  return validatedRelease(rows[0]);
}

interface ActiveReleaseSqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Resolve and lock the shared pointer using the caller's transaction. */
export async function readLockedActiveStandardRelease(executor: ActiveReleaseSqlExecutor): Promise<ActiveStandardRelease> {
  const result = await executor.execute(sql`
    SELECT r.id AS release_id,r.tmt_dataset_id,r.ttmt_dataset_id,r.state AS release_state,r.approved_at,
      t.state AS tmt_state,t.source AS tmt_source,u.state AS ttmt_state,u.source AS ttmt_source,v.status AS validation_status
    FROM standard_dataset_pointers p
    INNER JOIN standard_releases r ON r.id=p.active_release_id
    INNER JOIN standard_datasets t ON t.id=r.tmt_dataset_id
    INNER JOIN standard_datasets u ON u.id=r.ttmt_dataset_id
    LEFT JOIN tmt_run_validations v ON v.run_id=r.validation_run_id
    WHERE p.pointer_key=${ACTIVE_STANDARD_RELEASE_POINTER_KEY}
    LIMIT 1 FOR UPDATE
  `);
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] as ActiveReleaseRow[] : [];
  return validatedRelease(rows[0]);
}
