import { createHash, timingSafeEqual } from "node:crypto";
import type { MappingLifecycleStatus } from "@/modules/mappings/lifecycle";

export type ExportSelection = "all-mapped" | "manual-changes";

export interface ExportCandidateState {
  facilityId: string;
  mappingId: string;
  mappingSource: string;
  mappingUpdatedAt: Date;
  checkpointExportId: string | null;
  status: Exclude<MappingLifecycleStatus, "hidden">;
  standardValid: boolean;
}

export interface MappingExportCheckpointState {
  facilityId: string;
  mappingId: string;
  mappingUpdatedAt: Date;
}

export interface MappingExportCheckpointInsert extends MappingExportCheckpointState {
  exportId: string;
  exportedAt: Date;
}

export interface ExportPreviewTokenState {
  tokenHash: string;
  facilityId: string;
  selection: string;
  snapshotHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export function exportSnapshotHash(
  facilityId: string,
  selection: ExportSelection,
  candidates: Array<ExportCandidateState & { row: unknown }>,
): string {
  const payload = candidates.map((candidate) => ({
    mappingId: candidate.mappingId,
    mappingUpdatedAt: candidate.mappingUpdatedAt.toISOString(),
    checkpointExportId: candidate.checkpointExportId,
    row: candidate.row,
  }));
  return createHash("sha256").update(JSON.stringify({ facilityId, selection, payload })).digest("hex");
}

export function hashExportPreviewToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function isExportPreviewTokenValid(
  record: ExportPreviewTokenState,
  expected: {
    rawToken: string;
    facilityId: string;
    selection: ExportSelection;
    snapshotHash: string;
    now: Date;
  },
): boolean {
  const actualHash = Buffer.from(record.tokenHash, "hex");
  const expectedHash = Buffer.from(hashExportPreviewToken(expected.rawToken), "hex");
  return (
    actualHash.length === expectedHash.length &&
    timingSafeEqual(actualHash, expectedHash) &&
    record.facilityId === expected.facilityId &&
    record.selection === expected.selection &&
    record.snapshotHash === expected.snapshotHash &&
    record.consumedAt === null &&
    record.expiresAt.getTime() > expected.now.getTime()
  );
}

export function isExportCandidate(
  candidate: ExportCandidateState,
  checkpoint: MappingExportCheckpointState | null,
  selection: ExportSelection,
): boolean {
  if (candidate.status !== "mapped" || !candidate.standardValid) return false;
  if (selection === "all-mapped") return true;
  if (!checkpoint || checkpoint.facilityId !== candidate.facilityId || checkpoint.mappingId !== candidate.mappingId) return true;
  return checkpoint.mappingUpdatedAt.getTime() !== candidate.mappingUpdatedAt.getTime();
}

export function checkpointRowsAfterExport(
  candidates: ExportCandidateState[],
  exportId: string,
  exportedAt: Date,
): MappingExportCheckpointInsert[] {
  return candidates.map((candidate) => ({
    facilityId: candidate.facilityId,
    mappingId: candidate.mappingId,
    mappingUpdatedAt: candidate.mappingUpdatedAt,
    exportId,
    exportedAt,
  }));
}
