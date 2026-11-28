import assert from "node:assert/strict";
import type { Pool } from "mysql2/promise";
import { afterEach, test, vi } from "vitest";
import { lockStandardDatasetSelection, readStandardDatasetSelection } from "@/modules/standards/dataset-selection";
import { readStandardDatasetCounts } from "@/modules/standards/versioned-read";
import { readTmtConsumerContext } from "@/modules/tmt/readiness";

afterEach(() => vi.unstubAllEnvs());

const accepted = { dataset_id: "active-tmt", generation: 4, source: "TMT", state: "validated",
  content_hash: "a".repeat(64), manifest_hash: "a".repeat(64), assurance: "validated_unverified", coverage_through: "2026-11-28" };

test("TMT-only dataset selection is shared by readiness and locked writes, and Hub still reads live TTMT", async () => {
  vi.stubEnv("ACTIVE_STANDARD_RELEASE_ENABLED", "0");
  vi.stubEnv("TMT_INDEPENDENT_DATASET_ENABLED", "1");
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("tmt_active_dataset")) return [[accepted]];
    assert.match(sql, /tmt_dataset_mastertmt WHERE dataset_id=\?/);
    assert.match(sql, /SELECT COUNT\(\*\) FROM ttmt_products\)/);
    assert.doesNotMatch(sql, /ttmt_dataset_products/);
    assert.deepEqual(params, ["active-tmt"]);
    return [[{ tmt_total: 10, ttmt_total: 20 }]];
  });
  const pool = { query } as unknown as Pool;
  const selected = await readStandardDatasetSelection(pool);
  const context = await readTmtConsumerContext(pool);
  assert.deepEqual(context, { release: selected, readiness: { ready: true, assurance: "validated_unverified" } });
  assert.deepEqual(await readStandardDatasetCounts(pool, selected), { tmtTotal: 10, ttmtTotal: 20 });
  const execute = vi.fn(async () => [[accepted]]);
  assert.deepEqual(await lockStandardDatasetSelection({ execute }), selected);
  assert.equal(execute.mock.calls.length, 2);
  assert.equal(selected?.releaseId, "tmt:4:active-tmt");
  assert.equal(selected?.ttmtDatasetId, undefined);
  query.mockClear();
  assert.equal(await readStandardDatasetSelection(pool, false), undefined);
  assert.equal(query.mock.calls.length, 0);
});

test("a rejected pointer and a conflicting combined-release configuration fail closed", async () => {
  vi.stubEnv("TMT_INDEPENDENT_DATASET_ENABLED", "1");
  vi.stubEnv("ACTIVE_STANDARD_RELEASE_ENABLED", "0");
  const pool = { query: vi.fn(async () => [[{ ...accepted, state: "writing" }]]) } as unknown as Pool;
  await assert.rejects(readStandardDatasetSelection(pool), /POINTER_EVIDENCE_INVALID/);
  vi.stubEnv("ACTIVE_STANDARD_RELEASE_ENABLED", "1");
  await assert.rejects(readStandardDatasetSelection(pool), /MODES_CONFLICT/);
});
