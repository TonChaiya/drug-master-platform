import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  checkpointRowsAfterExport,
  exportSnapshotHash,
  hashExportPreviewToken,
  isExportCandidate,
  isExportPreviewTokenValid,
  type ExportCandidateState,
  type MappingExportCheckpointState,
} from "@/modules/exports/delta";

const exportedAt = new Date("2026-10-29T08:00:00.000Z");
const { buildExportCandidatesMock, transactionMock } = vi.hoisted(() => ({
  buildExportCandidatesMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/modules/exports/rows", () => ({ buildExportCandidates: buildExportCandidatesMock }));
vi.mock("@/db/client", () => ({ db: { transaction: transactionMock } }));

function candidate(overrides: Partial<ExportCandidateState> = {}): ExportCandidateState {
  return {
    facilityId: "facility-a",
    mappingId: "mapping-1",
    mappingSource: "manual",
    mappingUpdatedAt: new Date("2026-10-29T07:00:00.000Z"),
    checkpointExportId: null,
    status: "mapped",
    standardValid: true,
    ...overrides,
  };
}

function checkpoint(overrides: Partial<MappingExportCheckpointState> = {}): MappingExportCheckpointState {
  return {
    facilityId: "facility-a",
    mappingId: "mapping-1",
    mappingUpdatedAt: new Date("2026-10-29T07:00:00.000Z"),
    ...overrides,
  };
}

test("manual mapping already exported does not reappear in delta", () => {
  assert.equal(isExportCandidate(candidate(), checkpoint(), "manual-changes"), false);
});

test("mapping created after the checkpoint appears in delta", () => {
  assert.equal(isExportCandidate(candidate({ mappingId: "mapping-new" }), null, "manual-changes"), true);
});

test("mapping edited after its exported version reappears in delta", () => {
  assert.equal(
    isExportCandidate(
      candidate({ mappingUpdatedAt: new Date("2026-10-29T09:00:00.000Z") }),
      checkpoint(),
      "manual-changes",
    ),
    true,
  );
});

test("failed export does not advance checkpoints", async () => {
  buildExportCandidatesMock.mockResolvedValueOnce([]);
  const rawToken = "a".repeat(64);
  const insertMock = vi.fn();
  const txMock = {
    execute: vi.fn(),
    insert: insertMock,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              {
                tokenHash: hashExportPreviewToken(rawToken),
                facilityId: "facility-a",
                selection: "manual-changes",
                snapshotHash: exportSnapshotHash("facility-a", "manual-changes", []),
                expiresAt: new Date("2099-01-01T00:00:00.000Z"),
                consumedAt: null,
              },
            ]),
          })),
        })),
      })),
    })),
  };
  transactionMock.mockImplementationOnce(
    async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
  );
  const { createExport } = await import("@/modules/exports/service");

  await assert.rejects(
    createExport({
      facilityId: "facility-a",
      facilityCode: "00001",
      userId: "user-1",
      selection: "manual-changes",
      previewToken: rawToken,
    }),
    (error: Error & { code?: string }) => error.code === "EXPORT_EMPTY",
  );
  assert.equal(transactionMock.mock.calls.length, 1);
  assert.equal(insertMock.mock.calls.length, 0);
  assert.equal(buildExportCandidatesMock.mock.calls[0]?.[3], true, "download must use a locking current read");
}, 15_000);

test("successful full export checkpoints every row in the file", () => {
  const rows = [candidate(), candidate({ mappingId: "mapping-2" })];
  const checkpoints = checkpointRowsAfterExport(rows, "full.xls", exportedAt);

  assert.equal(checkpoints.length, 2);
  assert.equal(isExportCandidate(rows[0]!, checkpoints[0]!, "manual-changes"), false);
  assert.equal(isExportCandidate(rows[1]!, checkpoints[1]!, "manual-changes"), false);
});

test("needs_review mapping is excluded from every export selection", () => {
  const row = candidate({ status: "needs_review" });
  assert.equal(isExportCandidate(row, null, "all-mapped"), false);
  assert.equal(isExportCandidate(row, null, "manual-changes"), false);
});

test("facility A checkpoint does not suppress facility B delta", () => {
  assert.equal(
    isExportCandidate(candidate({ facilityId: "facility-b" }), checkpoint({ facilityId: "facility-a" }), "manual-changes"),
    true,
  );
});

test("preview token changes when facility, selection, mapping version, or exported row changes", () => {
  const base = [{ ...candidate(), row: { tmtid: "TMT-1" } }];
  const token = exportSnapshotHash("facility-a", "manual-changes", base);

  assert.notEqual(exportSnapshotHash("facility-b", "manual-changes", base), token);
  assert.notEqual(exportSnapshotHash("facility-a", "all-mapped", base), token);
  assert.notEqual(
    exportSnapshotHash("facility-a", "manual-changes", [
      { ...base[0]!, mappingUpdatedAt: new Date("2026-10-29T10:00:00.000Z") },
    ]),
    token,
  );
  assert.notEqual(exportSnapshotHash("facility-a", "manual-changes", [{ ...base[0]!, row: { tmtid: "TMT-2" } }]), token);
  assert.notEqual(
    exportSnapshotHash("facility-a", "manual-changes", [{ ...base[0]!, checkpointExportId: "export-new" }]),
    token,
  );
});

test("preview token rejects invalid, expired, consumed, and stale state", () => {
  const rawToken = "b".repeat(64);
  const now = new Date("2026-10-29T08:00:00.000Z");
  const record = {
    tokenHash: hashExportPreviewToken(rawToken),
    facilityId: "facility-a",
    selection: "manual-changes",
    snapshotHash: "c".repeat(64),
    expiresAt: new Date("2026-10-29T08:10:00.000Z"),
    consumedAt: null,
  } as const;
  const expected = {
    rawToken,
    facilityId: "facility-a",
    selection: "manual-changes" as const,
    snapshotHash: "c".repeat(64),
    now,
  };

  assert.equal(isExportPreviewTokenValid(record, expected), true);
  assert.equal(isExportPreviewTokenValid(record, { ...expected, rawToken: "d".repeat(64) }), false);
  assert.equal(isExportPreviewTokenValid(record, { ...expected, facilityId: "facility-b" }), false);
  assert.equal(isExportPreviewTokenValid(record, { ...expected, snapshotHash: "e".repeat(64) }), false);
  assert.equal(isExportPreviewTokenValid({ ...record, expiresAt: now }, expected), false);
  assert.equal(isExportPreviewTokenValid({ ...record, consumedAt: now }, expected), false);
});
