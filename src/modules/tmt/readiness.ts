import type { Pool, RowDataPacket } from "mysql2/promise";
import { dbPool } from "@/db/client";

export interface TmtReadinessRun {
  mode: string;
  status: string;
  tmtVersion: string;
}

export type TmtV2Readiness =
  | { ready: true; reason: null; run: TmtReadinessRun }
  | { ready: false; reason: "RUN_MISSING" | "RUN_UNVERIFIED" | "RUN_NOT_SUCCEEDED"; run: TmtReadinessRun | null };

export class TmtV2NotReadyError extends Error {
  readonly code = "TMT_V2_NOT_READY";
  constructor(readonly readiness: TmtV2Readiness) {
    super(`TMT v2 is not ready: ${readiness.reason ?? "unknown"}`);
    this.name = "TmtV2NotReadyError";
  }
}

export function evaluateTmtV2Readiness(run: TmtReadinessRun | null): TmtV2Readiness {
  if (!run) return { ready: false, reason: "RUN_MISSING", run: null };
  if (run.mode === "full_unverified" || run.tmtVersion.startsWith("unverified:")) {
    return { ready: false, reason: "RUN_UNVERIFIED", run };
  }
  if (run.status !== "succeeded") return { ready: false, reason: "RUN_NOT_SUCCEEDED", run };
  return { ready: true, reason: null, run };
}

export async function readTmtV2Readiness(pool: Pick<Pool, "query"> = dbPool()): Promise<TmtV2Readiness> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT mode,status,tmt_version FROM tmt_sync_runs ORDER BY started_at DESC,created_at DESC,id DESC LIMIT 1",
  );
  const row = rows[0];
  return evaluateTmtV2Readiness(row ? {
    mode: String(row.mode),
    status: String(row.status),
    tmtVersion: String(row.tmt_version),
  } : null);
}

export async function requireTmtV2Ready(pool: Pick<Pool, "query"> = dbPool()): Promise<void> {
  const readiness = await readTmtV2Readiness(pool);
  if (!readiness.ready) throw new TmtV2NotReadyError(readiness);
}
