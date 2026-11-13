import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { DatasetStagingError, manifestFor, stageDatasetCandidate, type DatasetStagingStore } from "@/modules/standards/dataset-staging";

function store(failWrite = false): DatasetStagingStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async transaction(work) { return work(this); },
    async createCandidate(input) { calls.push(`create:${input.state}`); return "pending"; },
    async writeSnapshot(input) { calls.push(`write:${input.datasetId}`); if (failWrite) throw new Error("write failed"); },
    async saveManifest(input) { calls.push(`manifest:${input.datasetId}`); },
    async finishCandidate(input) { calls.push(`finish:${input.state}`); },
  };
}

test("manifest is deterministic across row order", () => {
  const first = manifestFor([{ tableName: "tmt_dataset_concepts", rows: [{ tmtid: "2", fsn: "B" }, { tmtid: "1", fsn: "A" }] }]);
  const second = manifestFor([{ tableName: "tmt_dataset_concepts", rows: [{ fsn: "A", tmtid: "1" }, { fsn: "B", tmtid: "2" }] }]);
  assert.deepEqual(first, second);
});

test("manifest hashes rows in primary-key order for database verification", () => {
  const result = manifestFor([{ tableName: "tmt_dataset_concepts", rows: [
    { tmtid: "2", fsn: "A" },
    { tmtid: "1", fsn: "Z" },
  ] }]);
  const expected = createHash("sha256")
    .update('{"fsn":"Z","tmtid":"1"}\n{"fsn":"A","tmtid":"2"}')
    .digest("hex");
  assert.equal(result[0]?.contentHash, expected);
});

test("manifest normalizes MySQL date values and excludes operational timestamps", () => {
  const staged = manifestFor([{ tableName: "tmt_dataset_concepts", rows: [{
    tmtid: 1, fsn: "one", change_date: "2026-01-01", level_name: "tpu",
    source_version: "v1", last_seen_version: "v1", synced_at: "2026-01-01 00:00:00",
  }] }]);
  const persisted = manifestFor([{ tableName: "tmt_dataset_concepts", rows: [{
    tmtid: 1, fsn: "one", change_date: new Date("2026-01-01T00:00:00.000Z") as never, level_name: "tpu",
    source_version: "v1", last_seen_version: "v1", synced_at: new Date("2026-01-01T00:00:00.000Z") as never,
    created_at: new Date("2026-11-13T00:00:00.000Z") as never, updated_at: new Date("2026-11-13T00:00:00.000Z") as never,
  }] }]);
  assert.deepEqual(persisted, staged);
});

test("manifest normalizes BIGINT identifiers returned as numbers", () => {
  const staged = manifestFor([{ tableName: "tmt_dataset_relationships", rows: [{ concept1: "10", concept2: "20", fsn: "edge" }] }]);
  const persisted = manifestFor([{ tableName: "tmt_dataset_relationships", rows: [{ concept1: 10, concept2: 20, fsn: "edge" }] }]);
  assert.deepEqual(persisted, staged);
});

test("successful candidate writes a complete snapshot and manifest before validation", async () => {
  const target = store();
  await stageDatasetCandidate({ id: "candidate-1", source: "TMT", sourceVersion: "v1", tmtSyncRunId: "run-1", tables: [{ tableName: "tmt_dataset_concepts", rows: [{ tmtid: "1", fsn: "one" }] }] }, target);
  assert.deepEqual(target.calls, ["create:pending", "finish:writing", "write:candidate-1", "manifest:candidate-1", "finish:validated"]);
});

test("failed partial write marks only the candidate failed", async () => {
  const target = store(true);
  await assert.rejects(() => stageDatasetCandidate({ id: "candidate-2", source: "TTMT", sourceVersion: "v1", ttmtImportId: "import-1", tables: [{ tableName: "ttmt_dataset_products", rows: [{ ttmtcode: "1" }] }] }, target), /write failed/);
  assert.deepEqual(target.calls, ["create:pending", "finish:writing", "write:candidate-2", "finish:failed"]);
});

test("candidate rejects delta-only and active-dataset writes", async () => {
  const target = store();
  await assert.rejects(() => stageDatasetCandidate({ id: "candidate-3", source: "TMT", sourceVersion: "v1", tmtSyncRunId: "run-1", tables: [], snapshotKind: "incremental-delta" }, target), DatasetStagingError);
  await assert.rejects(() => stageDatasetCandidate({ id: "candidate-4", source: "TMT", sourceVersion: "v1", tmtSyncRunId: "run-1", tables: [{ tableName: "tmt_dataset_concepts", rows: [] }], activeDatasetId: "candidate-4" }, target), DatasetStagingError);
  assert.deepEqual(target.calls, []);
});
