import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { buildExportRows, type ExportSelection } from "./rows";
import { buildDrugCatWorkbook, exportFilename } from "./writer";

export interface ExportBundle {
  filename: string;
  buffer: Buffer;
  rowCount: number;
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
}): Promise<ExportBundle> {
  const rows = await buildExportRows(options.facilityId, options.selection);
  const buffer = buildDrugCatWorkbook(rows);
  const filename = exportFilename(options.facilityCode);

  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorUserId: options.userId,
    effectiveFacilityId: options.facilityId,
    action: "export.created",
    entityType: "export",
    entityId: filename,
    afterJson: { selection: options.selection, rowCount: rows.length, bytes: buffer.length },
  });

  return { filename, buffer, rowCount: rows.length };
}
