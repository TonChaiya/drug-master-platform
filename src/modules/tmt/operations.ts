import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tmtSyncCheckpoints, tmtSyncRuns, ttmtImports } from "@/db/schema";
import { readTmtV2Readiness, type TmtV2Readiness } from "./readiness";

const HISTORY_LIMIT = 10;
const CHECKPOINT_LIMIT = 100;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export interface TmtOperationRun {
  id: string;
  tmtVersion: string;
  mode: string;
  status: string;
  receivedRows: number;
  writtenRows: number;
  warningsCount: number;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TmtOperationCheckpoint {
  endpoint: string;
  windowBegin: string;
  windowEnd: string;
  status: string;
  receivedRows: number;
  writtenRows: number;
  attemptCount: number;
  errorCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TtmtOperationImport {
  id: string;
  version: string;
  filename: string;
  contentHash: string;
  rowCount: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

export interface TmtOperationsSnapshot {
  readiness: TmtV2Readiness;
  latestRun: TmtOperationRun | null;
  runs: TmtOperationRun[];
  checkpoints: TmtOperationCheckpoint[];
}

function toRun(row: typeof tmtSyncRuns.$inferSelect): TmtOperationRun {
  return {
    id: row.id, tmtVersion: row.tmtVersion, mode: row.mode, status: row.status,
    receivedRows: row.receivedRows, writtenRows: row.writtenRows, warningsCount: row.warningsCount,
    errorCode: row.errorCode, startedAt: row.startedAt.toISOString(), finishedAt: iso(row.finishedAt),
  };
}

export async function readTmtOperations(): Promise<TmtOperationsSnapshot> {
  const [readiness, rows] = await Promise.all([
    readTmtV2Readiness(),
    db.select().from(tmtSyncRuns).orderBy(desc(tmtSyncRuns.startedAt), desc(tmtSyncRuns.createdAt)).limit(HISTORY_LIMIT),
  ]);
  const runs = rows.map(toRun);
  const latestRun = runs[0] ?? null;
  const checkpointRows = latestRun
    ? await db.select().from(tmtSyncCheckpoints).where(eq(tmtSyncCheckpoints.runId, latestRun.id))
      .orderBy(asc(tmtSyncCheckpoints.endpoint), asc(tmtSyncCheckpoints.windowBegin), asc(tmtSyncCheckpoints.windowEnd)).limit(CHECKPOINT_LIMIT)
    : [];
  return {
    readiness,
    latestRun,
    runs,
    checkpoints: checkpointRows.map((row) => ({
      endpoint: row.endpoint, windowBegin: row.windowBegin, windowEnd: row.windowEnd, status: row.status,
      receivedRows: row.receivedRows, writtenRows: row.writtenRows, attemptCount: row.attemptCount,
      errorCode: row.errorCode, startedAt: iso(row.startedAt), finishedAt: iso(row.finishedAt),
    })),
  };
}

export async function listTtmtOperationImports(): Promise<TtmtOperationImport[]> {
  const rows = await db.select().from(ttmtImports).orderBy(desc(ttmtImports.startedAt), desc(ttmtImports.createdAt)).limit(HISTORY_LIMIT);
  return rows.map((row) => ({
    id: row.id, version: row.version, filename: row.filename, contentHash: row.contentHash, rowCount: row.rowCount,
    status: row.status, startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt),
  }));
}
