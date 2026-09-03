import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, standardProducts, standardSyncRuns } from "@/db/schema";
import { normalizeNlem } from "@/modules/mappings/ised";
import { fetchMasterTmt, fetchNlem, fetchRegno, fetchTmtVersion, type MasterTmtRecord, type NlemRecord, type RegnoRecord } from "./tmt-client";
import { normalizeRegistrationNumber, normalizeSearchText, standardStatusFromApi } from "./normalize";
import { partitionWindows, TMT_DATA_START, todayIso, type SyncWindow } from "./windows";

type SyncPhase = "master" | "enrich";

const UPSERT_CHUNK = 500;
/** Rows per CASE-batched UPDATE. Small enough to keep the statement readable to the server. */
const ENRICH_CHUNK = 200;

export interface StandardSyncResult {
  runId: string;
  resumed: boolean;
  /** True when the range was narrowed to what changed since the last success. */
  incremental: boolean;
  beginDate: string;
  endDate: string;
  completedWindows: number;
  totalWindows: number;
  version: string | null;
  windows: number;
  received: number;
  written: number;
  /** NLEM/registration rows applied to stored products in the second pass. */
  enriched: number;
  warnings: string[];
}

/**
 * Full MasterTMT sync for one date range.
 *
 * `/mastertmt` carries neither ISED nor the registration number, so `/nlem` and
 * `/regno` supply them, joined on `tpucode = tpuid` (docs/SPEC.md).
 *
 * It runs in two passes over the same windows, and the order is the point.
 * Applying a window's NLEM as it arrived only reached products already stored,
 * so a national-list record for a drug whose TPU record came in a later window
 * was dropped and never revisited — 3,432 of 3,447 missing NLEM values were
 * lost that way, and ISED goes straight into the DrugCat export. Loading every
 * product first, then applying NLEM and the registration numbers, removes the
 * ordering entirely.
 *
 * The run is only marked successful once both passes have covered every
 * window; a failure leaves the phase and the next window as the resume point.
 */
export interface SyncProgress {
  status: string;
  beginDate: string | null;
  endDate: string | null;
  completedWindows: number;
  totalWindows: number;
  percent: number;
  receivedRows: number;
  changedRows: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  resumable: boolean;
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : null;
}

/** Latest TMT run, shaped for the progress bar on the standards page. */
export async function readSyncProgress(): Promise<SyncProgress | null> {
  const rows = await db
    .select()
    .from(standardSyncRuns)
    .where(eq(standardSyncRuns.source, "TMT"))
    .orderBy(desc(standardSyncRuns.startedAt))
    .limit(1);
  const run = rows[0];
  if (!run) return null;

  const total = run.totalWindows || 0;
  return {
    status: run.status,
    beginDate: isoDate(run.windowBegin),
    endDate: isoDate(run.windowEnd),
    completedWindows: run.completedWindows,
    totalWindows: total,
    percent: total > 0 ? Math.min(100, Math.round((run.completedWindows / total) * 100)) : 0,
    receivedRows: run.receivedRows,
    changedRows: run.changedRows,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    errorCode: run.errorCode,
    resumable: run.nextWindowBegin !== null && run.status !== "succeeded",
  };
}

/**
 * Every endpoint is change-based: begindate/enddate select records whose
 * change_date falls in the range. So a repeat sync only has to ask for what
 * changed since the last successful one, which is why pressing the button again
 * is quick and still picks up TMT's edits.
 *
 * The window is backdated by an overlap because change_date can sit a little
 * before the boundary we last asked for; re-reading a month costs one request
 * per endpoint and is the difference between catching a late record and losing
 * it for good.
 */
const INCREMENTAL_OVERLAP_DAYS = 30;

async function lastSuccessfulEnd(): Promise<string | null> {
  const rows = await db
    .select({ windowEnd: standardSyncRuns.windowEnd })
    .from(standardSyncRuns)
    .where(and(eq(standardSyncRuns.source, "TMT"), eq(standardSyncRuns.status, "succeeded")))
    .orderBy(desc(standardSyncRuns.startedAt))
    .limit(1);
  const value: unknown = rows[0]?.windowEnd;
  if (!value) return null;
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const backdated = Date.parse(`${iso}T00:00:00Z`) - INCREMENTAL_OVERLAP_DAYS * 86_400_000;
  return new Date(backdated).toISOString().slice(0, 10);
}

/** A run that stopped before finishing every window and can be picked up again. */
async function findResumableRun() {
  const rows = await db
    .select()
    .from(standardSyncRuns)
    .where(and(eq(standardSyncRuns.source, "TMT"), inArray(standardSyncRuns.status, ["running", "failed"])))
    .orderBy(desc(standardSyncRuns.startedAt))
    .limit(1);
  const run = rows[0];
  return run?.nextWindowBegin ? run : null;
}

export async function syncMasterTmt(options: {
  /** Defaults to the first date TMT holds data for. */
  beginDate?: string;
  /** Defaults to today. */
  endDate?: string;
  userId: string;
  fetcher?: typeof fetch;
  /** Set false to force a fresh run instead of continuing an unfinished one. */
  resume?: boolean;
}): Promise<StandardSyncResult> {
  const fetcher = options.fetcher ?? fetch;
  const startedAt = new Date();
  const warnings: string[] = [];

  const versionResult = await fetchTmtVersion(fetcher);
  const version = versionResult.tmtVersion;
  if (!versionResult.ok) warnings.push(`อ่านเวอร์ชัน TMT ไม่สำเร็จ: ${versionResult.message}`);

  const previous = options.resume === false ? null : await findResumableRun();

  // With no dates: continue where a successful run left off, or load the whole
  // history the first time. An explicit range always wins.
  const since = options.beginDate ? null : await lastSuccessfulEnd();
  const incremental = previous === null && options.beginDate === undefined && since !== null;

  // Resuming keeps the original range and picks up at the first window that was
  // never applied, so a dropped connection costs one window, not the whole load.
  const beginDate = previous?.windowBegin ?? options.beginDate ?? since ?? TMT_DATA_START;
  const endDate = previous?.windowEnd ?? options.endDate ?? todayIso();
  const allWindows = partitionWindows(beginDate, endDate);
  const windows = previous?.nextWindowBegin
    ? allWindows.filter((window) => window.enddate >= previous.nextWindowBegin!)
    : allWindows;

  const runId = previous?.id ?? randomUUID();
  const alreadyDone = allWindows.length - windows.length;
  const startPhase: SyncPhase = previous?.phase === "enrich" ? "enrich" : "master";

  if (previous) {
    await db
      .update(standardSyncRuns)
      .set({ status: "running", cursorValue: version, errorCode: null, finishedAt: null })
      .where(eq(standardSyncRuns.id, runId));
  } else {
    await db.insert(standardSyncRuns).values({
      id: runId,
      source: "TMT",
      method: "api",
      windowBegin: beginDate,
      windowEnd: endDate,
      cursorValue: version,
      status: "running",
      startedBy: options.userId,
      startedAt,
      nextWindowBegin: allWindows[0]?.begindate ?? null,
      totalWindows: allWindows.length * 2,
      phase: "master",
    });
  }

  let received = previous?.receivedRows ?? 0;
  let written = previous?.changedRows ?? 0;
  let enriched = 0;
  let completed = alreadyDone;

  /** Records progress after each window so a resume knows where to pick up. */
  async function markWindow(window: SyncWindow, phase: SyncPhase): Promise<void> {
    completed += 1;
    const nextBegin = new Date(Date.parse(`${window.enddate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const finishedPhase = nextBegin > endDate;
    await db
      .update(standardSyncRuns)
      .set({
        receivedRows: received,
        changedRows: written,
        completedWindows: completed,
        totalWindows: allWindows.length * 2,
        // Finishing the master pass rewinds to the first window for the second.
        phase: finishedPhase && phase === "master" ? "enrich" : phase,
        nextWindowBegin: finishedPhase ? (phase === "master" ? beginDate : null) : nextBegin,
      })
      .where(eq(standardSyncRuns.id, runId));
  }

  try {
    if (startPhase === "master") {
      for (const window of windows) {
        const applied = await loadMasterWindow(window, version ?? "unknown", fetcher, warnings);
        received += applied.received;
        written += applied.written;
        await markWindow(window, "master");
      }
    }

    // Every product is stored by now, so nothing NLEM reports can miss its row.
    for (const window of startPhase === "enrich" ? windows : allWindows) {
      enriched += await applyEnrichmentWindow(window, fetcher, warnings);
      await markWindow(window, "enrich");
    }

    await db
      .update(standardSyncRuns)
      .set({ status: "succeeded", receivedRows: received, changedRows: written, completedWindows: completed, nextWindowBegin: null, phase: null, finishedAt: new Date() })
      .where(eq(standardSyncRuns.id, runId));

    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.userId,
      action: "standards.tmt_synced",
      entityType: "standard_sync_run",
      entityId: runId,
      afterJson: { version, windows: windows.length, received, written, enriched, warnings: warnings.length },
    });

    return {
      runId,
      resumed: previous !== null,
      incremental,
      beginDate,
      endDate,
      completedWindows: completed,
      totalWindows: allWindows.length * 2,
      version,
      windows: windows.length,
      received,
      written,
      enriched,
      warnings,
    };
  } catch (error) {
    const code = error instanceof Error ? error.name : "UNKNOWN";
    await db
      .update(standardSyncRuns)
      // nextWindowBegin is deliberately left where it is: it is the resume point.
      .set({ status: "failed", errorCode: code.slice(0, 64), receivedRows: received, changedRows: written, completedWindows: completed, finishedAt: new Date() })
      .where(eq(standardSyncRuns.id, runId));
    throw error;
  }
}

/** First pass: the product records themselves. ISED and the registration
 * number are left for the second pass, which runs once every product exists. */
async function loadMasterWindow(
  window: SyncWindow,
  version: string,
  fetcher: typeof fetch,
  warnings: string[],
): Promise<{ received: number; written: number }> {
  const master = await fetchMasterTmt(window, fetcher);
  const values = master.map((row) => toStandardProduct(row, version, warnings));

  let written = 0;
  for (let start = 0; start < values.length; start += UPSERT_CHUNK) {
    const chunk = values.slice(start, start + UPSERT_CHUNK);
    if (chunk.length === 0) continue;
    await db
      .insert(standardProducts)
      .values(chunk)
      .onDuplicateKeyUpdate({
        set: {
          standardType: sql`values(${standardProducts.standardType})`,
          activeIngredient: sql`values(${standardProducts.activeIngredient})`,
          strength: sql`values(${standardProducts.strength})`,
          dosageForm: sql`values(${standardProducts.dosageForm})`,
          contentValue: sql`values(${standardProducts.contentValue})`,
          contentUnit: sql`values(${standardProducts.contentUnit})`,
          dispensingUnit: sql`values(${standardProducts.dispensingUnit})`,
          tradeName: sql`values(${standardProducts.tradeName})`,
          manufacturer: sql`values(${standardProducts.manufacturer})`,
          fsn: sql`values(${standardProducts.fsn})`,
          status: sql`values(${standardProducts.status})`,
          sourceVersion: sql`values(${standardProducts.sourceVersion})`,
          normalizedGeneric: sql`values(${standardProducts.normalizedGeneric})`,
          normalizedTrade: sql`values(${standardProducts.normalizedTrade})`,
          normalizedManufacturer: sql`values(${standardProducts.normalizedManufacturer})`,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        },
      });
    written += chunk.length;
  }

  return { received: master.length, written };
}

/** Second pass: ISED and registration numbers onto products already loaded. */
async function applyEnrichmentWindow(window: SyncWindow, fetcher: typeof fetch, warnings: string[]): Promise<number> {
  const [nlem, regno] = await Promise.all([fetchNlem(window, fetcher), fetchRegno(window, fetcher)]);
  return (await applyNlemToStoredProducts(nlem, warnings)) + (await applyRegnoToStoredProducts(regno));
}

/**
 * Applies NLEM to products already in the catalogue. Only rows that exist are
 * touched: a TPU we have never seen has no name, strength or manufacturer, and
 * inserting a shell row for it would put an unsearchable entry in front of the
 * people doing the mapping.
 */
async function applyNlemToStoredProducts(entries: NlemRecord[], warnings: string[]): Promise<number> {
  let matched = 0;
  for (let start = 0; start < entries.length; start += ENRICH_CHUNK) {
    const chunk = entries.slice(start, start + ENRICH_CHUNK);
    const normalized = chunk.map((row) => {
      const ised = normalizeNlem(row.nlem);
      if (ised.warning && warnings.length < 50) warnings.push(`${row.tpuid}: ${ised.warning}`);
      return { code: row.tpuid, raw: ised.raw, exportValue: ised.exportValue };
    });
    const [result] = await db
      .update(standardProducts)
      .set({
        rawNlem: sql`CASE ${standardProducts.standardCode} ${sql.join(normalized.map((row) => sql`WHEN ${row.code} THEN ${row.raw}`), sql` `)} END`,
        exportIsed: sql`CASE ${standardProducts.standardCode} ${sql.join(normalized.map((row) => sql`WHEN ${row.code} THEN ${row.exportValue}`), sql` `)} END`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where(and(eq(standardProducts.standardType, "TMT"), inArray(standardProducts.standardCode, normalized.map((row) => row.code))));
    matched += result.affectedRows;
  }
  return matched;
}

async function applyRegnoToStoredProducts(entries: RegnoRecord[]): Promise<number> {
  let matched = 0;
  for (let start = 0; start < entries.length; start += ENRICH_CHUNK) {
    const chunk = entries.slice(start, start + ENRICH_CHUNK);
    const [result] = await db
      .update(standardProducts)
      .set({
        registrationNumber: sql`CASE ${standardProducts.standardCode} ${sql.join(chunk.map((row) => sql`WHEN ${row.tpuid} THEN ${row.regno}`), sql` `)} END`,
        normalizedRegno: sql`CASE ${standardProducts.standardCode} ${sql.join(chunk.map((row) => sql`WHEN ${row.tpuid} THEN ${normalizeRegistrationNumber(row.regno)}`), sql` `)} END`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where(and(eq(standardProducts.standardType, "TMT"), inArray(standardProducts.standardCode, chunk.map((row) => row.tpuid))));
    matched += result.affectedRows;
  }
  return matched;
}

/**
 * Caps every value at its column width.
 *
 * MasterTMT once returned a 353-character strength and the entire window's
 * insert failed, which stalled the historical load at that year. Truncating a
 * single oversized field degrades one row instead of losing thousands.
 */
function cap(value: string | null, limit: number): string | null {
  if (value === null) return null;
  return value.length <= limit ? value : value.slice(0, limit);
}

function toStandardProduct(
  row: MasterTmtRecord,
  version: string,
  warnings: string[],
): typeof standardProducts.$inferInsert {
  void warnings;
  return {
    id: randomUUID(),
    standardCode: cap(row.tpucode, 64) ?? row.tpucode,
    standardType: "TMT",
    activeIngredient: row.activeingredient,
    strength: row.strength,
    dosageForm: cap(row.dosageform, 255),
    contentValue: cap(row.contvalue, 80),
    contentUnit: cap(row.contunit, 80),
    dispensingUnit: cap(row.dispunit, 80),
    tradeName: cap(row.tradename, 255),
    manufacturer: cap(row.manufacturer, 255),
    fsn: row.fsn,
    status: standardStatusFromApi(row.status),
    sourceVersion: version,
    normalizedGeneric: normalizeSearchText(row.activeingredient),
    normalizedTrade: normalizeSearchText(row.tradename),
    normalizedManufacturer: normalizeSearchText(row.manufacturer),
  };
}
