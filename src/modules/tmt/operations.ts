import { asc, desc, eq, sql } from "drizzle-orm";
import { db, dbPool } from "@/db/client";
import { tmtSyncCheckpoints, tmtSyncRuns, ttmtImports } from "@/db/schema";
import { readTmtV2Readiness, type TmtV2Readiness } from "./readiness";
import { independentTmtDatasetsEnabled, tmtCandidateControlsEnabled } from "./feature";
import { readCandidateOperations } from "./candidate-jobs";
import { isTmtPointerUnavailable } from "./candidate-pointer";

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
  readiness: TmtV2Readiness | { ready: true; assurance: "verified" | "validated_unverified"; reason: null; run: null };
  latestRun: TmtOperationRun | null;
  runs: TmtOperationRun[];
  checkpoints: TmtOperationCheckpoint[];
  candidateOperations?: Awaited<ReturnType<typeof readCandidateOperations>> & { controlsEnabled: boolean };
  progress: {
    total: number;
    succeeded: number;
    failed: number;
    receivedRows: number;
    writtenRows: number;
    windowBegin: string;
    windowEnd: string;
    latestRecorded: TmtOperationCheckpoint | null;
  } | null;
}

function toRun(row: typeof tmtSyncRuns.$inferSelect): TmtOperationRun {
  return {
    id: row.id, tmtVersion: row.tmtVersion, mode: row.mode, status: row.status,
    receivedRows: row.receivedRows, writtenRows: row.writtenRows, warningsCount: row.warningsCount,
    errorCode: row.errorCode, startedAt: row.startedAt.toISOString(), finishedAt: iso(row.finishedAt),
  };
}

export async function readTmtOperations(): Promise<TmtOperationsSnapshot> {
  const independent = independentTmtDatasetsEnabled();
  const [legacy, candidate, rows] = await Promise.all([
    independent ? undefined : readTmtV2Readiness(),
    independent ? readCandidateOperations(dbPool()).catch((error: unknown) => {
      if (isTmtPointerUnavailable(error)) return undefined;
      throw error;
    }) : undefined,
    db.select().from(tmtSyncRuns).orderBy(desc(tmtSyncRuns.startedAt), desc(tmtSyncRuns.createdAt)).limit(HISTORY_LIMIT),
  ]);
  const runs = rows.map(toRun);
  const latestRun = runs[0] ?? null;
  const { checkpoints, progress } = latestRun
    ? await readTmtCheckpointProgress(latestRun.id)
    : { checkpoints: [], progress: null };
  const assurance = candidate?.pointer.assurance;
  const readiness: TmtOperationsSnapshot["readiness"] = legacy ?? (assurance
    ? { ready: true, assurance, reason: null, run: null }
    : { ready: false, assurance: null, reason: "POINTER_UNAVAILABLE", run: null });
  const candidateOperations = candidate ? { ...candidate, controlsEnabled: tmtCandidateControlsEnabled() } : undefined;
  return { readiness, latestRun, runs, checkpoints, progress, candidateOperations };
}

export async function readTmtCheckpointProgress(runId: string): Promise<Pick<TmtOperationsSnapshot, "checkpoints" | "progress">> {
  const checkpoint = tmtSyncCheckpoints;
  // Window expressions see every checkpoint of the run before the display LIMIT.
  const rows = await db.select({
    endpoint: checkpoint.endpoint, windowBegin: checkpoint.windowBegin, windowEnd: checkpoint.windowEnd,
    status: checkpoint.status, receivedRows: checkpoint.receivedRows, writtenRows: checkpoint.writtenRows,
    attemptCount: checkpoint.attemptCount, errorCode: checkpoint.errorCode,
    startedAt: checkpoint.startedAt, finishedAt: checkpoint.finishedAt,
    total: sql<number>`COUNT(*) OVER ()`.mapWith(Number),
    succeeded: sql<number>`SUM(CASE WHEN ${checkpoint.status} = 'succeeded' THEN 1 ELSE 0 END) OVER ()`.mapWith(Number),
    failed: sql<number>`SUM(CASE WHEN ${checkpoint.status} = 'failed' THEN 1 ELSE 0 END) OVER ()`.mapWith(Number),
    received: sql<number>`SUM(${checkpoint.receivedRows}) OVER ()`.mapWith(Number),
    written: sql<number>`SUM(${checkpoint.writtenRows}) OVER ()`.mapWith(Number),
    firstDate: sql<string>`DATE_FORMAT(MIN(${checkpoint.windowBegin}) OVER (), '%Y-%m-%d')`,
    lastDate: sql<string>`DATE_FORMAT(MAX(${checkpoint.windowEnd}) OVER (), '%Y-%m-%d')`,
  }).from(checkpoint).where(eq(checkpoint.runId, runId))
    .orderBy(desc(checkpoint.finishedAt), asc(checkpoint.endpoint), asc(checkpoint.windowBegin), asc(checkpoint.windowEnd))
    .limit(CHECKPOINT_LIMIT);
  const checkpoints = rows.map((row) => ({
    endpoint: row.endpoint, windowBegin: row.windowBegin, windowEnd: row.windowEnd, status: row.status,
    receivedRows: row.receivedRows, writtenRows: row.writtenRows, attemptCount: row.attemptCount,
    errorCode: row.errorCode, startedAt: iso(row.startedAt), finishedAt: iso(row.finishedAt),
  }));
  const first = rows[0];
  return {
    checkpoints,
    progress: first ? {
      total: first.total, succeeded: first.succeeded, failed: first.failed, receivedRows: first.received, writtenRows: first.written,
      windowBegin: first.firstDate, windowEnd: first.lastDate,
      latestRecorded: checkpoints[0]?.finishedAt ? checkpoints[0] : null,
    } : null,
  };
}

export async function listTtmtOperationImports(): Promise<TtmtOperationImport[]> {
  const rows = await db.select().from(ttmtImports).orderBy(desc(ttmtImports.startedAt), desc(ttmtImports.createdAt)).limit(HISTORY_LIMIT);
  return rows.map((row) => ({
    id: row.id, version: row.version, filename: row.filename, contentHash: row.contentHash, rowCount: row.rowCount,
    status: row.status, startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt),
  }));
}
