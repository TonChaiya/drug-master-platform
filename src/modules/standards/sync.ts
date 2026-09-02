import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, standardProducts, standardSyncRuns } from "@/db/schema";
import { normalizeNlem } from "@/modules/mappings/ised";
import { fetchMasterTmt, fetchNlem, fetchRegno, fetchTmtVersion, type MasterTmtRecord } from "./tmt-client";
import { normalizeRegistrationNumber, normalizeSearchText, standardStatusFromApi } from "./normalize";
import { partitionWindows, type SyncWindow } from "./windows";

const UPSERT_CHUNK = 500;

export interface StandardSyncResult {
  runId: string;
  version: string | null;
  windows: number;
  received: number;
  written: number;
  warnings: string[];
}

/**
 * Full MasterTMT sync for one date range.
 *
 * `/mastertmt` carries neither ISED nor the registration number, so each window
 * is enriched by joining `/nlem` and `/regno` on `tpucode = tpuid` before
 * anything is written (docs/SPEC.md). The run is only marked successful once
 * every partition has been applied.
 */
export async function syncMasterTmt(options: {
  beginDate: string;
  endDate: string;
  userId: string;
  fetcher?: typeof fetch;
}): Promise<StandardSyncResult> {
  const fetcher = options.fetcher ?? fetch;
  const runId = randomUUID();
  const startedAt = new Date();
  const warnings: string[] = [];

  const versionResult = await fetchTmtVersion(fetcher);
  const version = versionResult.tmtVersion;
  if (!versionResult.ok) warnings.push(`อ่านเวอร์ชัน TMT ไม่สำเร็จ: ${versionResult.message}`);

  const windows = partitionWindows(options.beginDate, options.endDate);

  await db.insert(standardSyncRuns).values({
    id: runId,
    source: "TMT",
    method: "api",
    windowBegin: options.beginDate,
    windowEnd: options.endDate,
    cursorValue: version,
    status: "running",
    startedBy: options.userId,
    startedAt,
  });

  let received = 0;
  let written = 0;

  try {
    for (const window of windows) {
      const applied = await syncOneWindow(window, version ?? "unknown", fetcher, warnings);
      received += applied.received;
      written += applied.written;
      await db
        .update(standardSyncRuns)
        .set({ receivedRows: received, changedRows: written })
        .where(eq(standardSyncRuns.id, runId));
    }

    await db
      .update(standardSyncRuns)
      .set({ status: "succeeded", receivedRows: received, changedRows: written, finishedAt: new Date() })
      .where(eq(standardSyncRuns.id, runId));

    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.userId,
      action: "standards.tmt_synced",
      entityType: "standard_sync_run",
      entityId: runId,
      afterJson: { version, windows: windows.length, received, written, warnings: warnings.length },
    });

    return { runId, version, windows: windows.length, received, written, warnings };
  } catch (error) {
    const code = error instanceof Error ? error.name : "UNKNOWN";
    await db
      .update(standardSyncRuns)
      .set({ status: "failed", errorCode: code.slice(0, 64), receivedRows: received, changedRows: written, finishedAt: new Date() })
      .where(eq(standardSyncRuns.id, runId));
    throw error;
  }
}

async function syncOneWindow(
  window: SyncWindow,
  version: string,
  fetcher: typeof fetch,
  warnings: string[],
): Promise<{ received: number; written: number }> {
  const [master, nlem, regno] = await Promise.all([
    fetchMasterTmt(window, fetcher),
    fetchNlem(window, fetcher),
    fetchRegno(window, fetcher),
  ]);

  const nlemByCode = new Map(nlem.map((row) => [row.tpuid, row]));
  const regnoByCode = new Map(regno.map((row) => [row.tpuid, row]));

  const values = master.map((row) => toStandardProduct(row, nlemByCode.get(row.tpucode)?.nlem ?? null, regnoByCode.get(row.tpucode)?.regno ?? null, version, warnings));

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
          rawNlem: sql`values(${standardProducts.rawNlem})`,
          exportIsed: sql`values(${standardProducts.exportIsed})`,
          registrationNumber: sql`values(${standardProducts.registrationNumber})`,
          sourceVersion: sql`values(${standardProducts.sourceVersion})`,
          normalizedGeneric: sql`values(${standardProducts.normalizedGeneric})`,
          normalizedTrade: sql`values(${standardProducts.normalizedTrade})`,
          normalizedManufacturer: sql`values(${standardProducts.normalizedManufacturer})`,
          normalizedRegno: sql`values(${standardProducts.normalizedRegno})`,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        },
      });
    written += chunk.length;
  }

  return { received: master.length, written };
}

function toStandardProduct(
  row: MasterTmtRecord,
  rawNlem: string | null,
  registrationNumber: string | null,
  version: string,
  warnings: string[],
): typeof standardProducts.$inferInsert {
  const ised = normalizeNlem(rawNlem);
  if (ised.warning && warnings.length < 50) warnings.push(`${row.tpucode}: ${ised.warning}`);

  return {
    id: randomUUID(),
    standardCode: row.tpucode,
    standardType: "TMT",
    activeIngredient: row.activeingredient,
    strength: row.strength,
    dosageForm: row.dosageform,
    contentValue: row.contvalue,
    contentUnit: row.contunit,
    dispensingUnit: row.dispunit,
    tradeName: row.tradename,
    manufacturer: row.manufacturer,
    fsn: row.fsn,
    status: standardStatusFromApi(row.status),
    rawNlem: ised.raw,
    exportIsed: ised.exportValue,
    registrationNumber,
    sourceVersion: version,
    normalizedGeneric: normalizeSearchText(row.activeingredient),
    normalizedTrade: normalizeSearchText(row.tradename),
    normalizedManufacturer: normalizeSearchText(row.manufacturer),
    normalizedRegno: normalizeRegistrationNumber(registrationNumber),
  };
}
