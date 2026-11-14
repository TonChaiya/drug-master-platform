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

export interface StandardDatasetCounts {
  tmtTotal: number;
  ttmtTotal: number;
}

/** Keep the Hub summary on the same explicit datasets as its search consumers. */
export async function readStandardDatasetCounts(
  pool: Pick<Pool, "query">,
  release?: ActiveStandardRelease,
): Promise<StandardDatasetCounts> {
  const [rows] = await pool.query<RowDataPacket[]>(release
    ? `SELECT
        (SELECT COUNT(*) FROM tmt_dataset_mastertmt WHERE dataset_id=?) AS tmt_total,
        (SELECT COUNT(*) FROM ttmt_dataset_products WHERE dataset_id=?) AS ttmt_total`
    : `SELECT
        (SELECT COUNT(*) FROM tmt_mastertmt) AS tmt_total,
        (SELECT COUNT(*) FROM ttmt_products) AS ttmt_total`,
  release ? [release.tmtDatasetId, release.ttmtDatasetId] : []);
  return { tmtTotal: Number(rows[0]?.tmt_total ?? 0), ttmtTotal: Number(rows[0]?.ttmt_total ?? 0) };
}
