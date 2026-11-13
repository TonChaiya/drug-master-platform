import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ActiveStandardRelease } from "./active-release";

/** Read-only parameterized adapter; callers must pass one resolved release per operation. */
export async function findVersionedTmtConcepts(pool: Pick<Pool, "query">, release: ActiveStandardRelease, tmtId: string): Promise<RowDataPacket[]> {
  return (await pool.query<RowDataPacket[]>(
    "SELECT tmtid,fsn,level_name,source_version FROM tmt_dataset_concepts WHERE dataset_id=? AND tmtid=?",
    [release.tmtDatasetId, tmtId],
  ))[0];
}

export async function findVersionedTtmtProduct(pool: Pick<Pool, "query">, release: ActiveStandardRelease, code: string): Promise<RowDataPacket[]> {
  return (await pool.query<RowDataPacket[]>(
    "SELECT ttmtcode,fsn,status,source_version FROM ttmt_dataset_products WHERE dataset_id=? AND ttmtcode=?",
    [release.ttmtDatasetId, code],
  ))[0];
}
