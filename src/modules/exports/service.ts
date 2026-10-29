import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, exportPreviewTokens, facilities, mappingExportCheckpoints } from "@/db/schema";
import {
  checkpointRowsAfterExport,
  exportSnapshotHash,
  hashExportPreviewToken,
  isExportPreviewTokenValid,
} from "./delta";
import { buildExportCandidates, type ExportCandidate, type ExportSelection } from "./rows";
import { buildDrugCatWorkbook, exportFilename } from "./writer";

export interface ExportBundle {
  filename: string;
  buffer: Buffer;
  rowCount: number;
}

export class ExportPreviewStaleError extends Error {
  readonly code = "EXPORT_PREVIEW_STALE";

  constructor() {
    super("ข้อมูลเปลี่ยนหลังจากแสดงตัวอย่าง กรุณาตรวจตัวอย่างล่าสุดแล้วดาวน์โหลดอีกครั้ง");
    this.name = "ExportPreviewStaleError";
  }
}

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export async function createExportPreview(
  facilityId: string,
  selection: ExportSelection,
): Promise<{ candidates: ExportCandidate[]; previewToken: string }> {
  const candidates = await buildExportCandidates(facilityId, selection);
  const previewToken = randomBytes(32).toString("hex");
  const now = new Date();
  await db.insert(exportPreviewTokens).values({
    tokenHash: hashExportPreviewToken(previewToken),
    facilityId,
    selection,
    snapshotHash: exportSnapshotHash(facilityId, selection, candidates),
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
    consumedAt: null,
    createdAt: now,
  });
  return { candidates, previewToken };
}

/**
 * Produces the downloadable file. The preview screen queries the same
 * `buildExportRows`, so the count the user confirms is the count in the file.
 */
export async function createExport(options: {
  facilityId: string;
  facilityCode: string;
  userId: string;
  selection: ExportSelection;
  previewToken: string;
}): Promise<ExportBundle> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT ${facilities.id} FROM ${facilities} WHERE ${facilities.id} = ${options.facilityId} FOR UPDATE`,
    );
    const tokenHash = hashExportPreviewToken(options.previewToken);
    const tokenRows = await tx
      .select()
      .from(exportPreviewTokens)
      .where(eq(exportPreviewTokens.tokenHash, tokenHash))
      .for("update")
      .limit(1);
    const token = tokenRows[0];
    if (!token) throw new ExportPreviewStaleError();

    const candidates = await buildExportCandidates(options.facilityId, options.selection, tx, true);
    const now = new Date();
    if (
      !isExportPreviewTokenValid(token, {
        rawToken: options.previewToken,
        facilityId: options.facilityId,
        selection: options.selection,
        snapshotHash: exportSnapshotHash(options.facilityId, options.selection, candidates),
        now,
      })
    ) {
      throw new ExportPreviewStaleError();
    }

    const rows = candidates.map((candidate) => candidate.row);
    const buffer = buildDrugCatWorkbook(rows);
    const filename = exportFilename(options.facilityCode);
    const exportId = randomUUID();
    const exportedAt = now;
    const checkpoints = checkpointRowsAfterExport(candidates, exportId, exportedAt);

    const [consumeResult] = await tx
      .update(exportPreviewTokens)
      .set({ consumedAt: exportedAt })
      .where(
        and(
          eq(exportPreviewTokens.tokenHash, tokenHash),
          eq(exportPreviewTokens.facilityId, options.facilityId),
          isNull(exportPreviewTokens.consumedAt),
        ),
      );
    if (consumeResult.affectedRows !== 1) throw new ExportPreviewStaleError();

    for (let start = 0; start < checkpoints.length; start += 500) {
      await tx
        .insert(mappingExportCheckpoints)
        .values(checkpoints.slice(start, start + 500))
        .onDuplicateKeyUpdate({
          set: {
            mappingUpdatedAt: sql`VALUES(mapping_updated_at)`,
            exportId: sql`VALUES(export_id)`,
            exportedAt: sql`VALUES(exported_at)`,
          },
        });
    }
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: options.userId,
      effectiveFacilityId: options.facilityId,
      action: "export.created",
      entityType: "export",
      entityId: exportId,
      afterJson: { filename, selection: options.selection, rowCount: rows.length, bytes: buffer.length },
    });
    return { filename, buffer, rowCount: rows.length };
  });
}
