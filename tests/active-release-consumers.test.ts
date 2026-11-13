import assert from "node:assert/strict";
import { test } from "vitest";
import type { Pool } from "mysql2/promise";
import { exportSnapshotHash, type ExportCandidateState } from "@/modules/exports/delta";
import { searchTmt } from "@/modules/tmt/search";
import { loadDirectTmtRelationships } from "@/modules/tmt/graph";
import { searchTtmtStandards } from "@/modules/standards/ttmt-search";

const release = { releaseId: "release-a", tmtDatasetId: "tmt-a", ttmtDatasetId: "ttmt-a" };

test("versioned TMT search scopes every query to one dataset and preserves response enrichment", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = { query: async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes("FROM tmt_dataset_concepts c")) return [[{ tmtid: 565818, level_name: "tpu", concept_fsn: "Concept", source_version: "v1", endpoint_fsn: "TPU", manufacturer: "Maker", master_status: 0, activeingredient: "Drug", strength: "5 mg", dosageform: "tablet", contvalue: "1", contunit: "tablet", dispunit: "box", tradename: "Trade" }], []];
    if (sql.includes("SELECT concept1")) return [[{ id: 565818, level_name: "gp", total: 1 }], []];
    if (sql.includes("SELECT r.tpuid")) return [[{ tmt_id: 565818, regno: "REG-1", change_date: "2026-01-01" }], []];
    return [[], []];
  } } as unknown as Pool;
  const rows = await searchTmt(pool, { query: "565818", manufacturer: "Maker", registration: "REG", atc: "A01", nlem: "ED", limit: 5 }, release);
  assert.equal(rows[0]?.endpointFsn, "TPU");
  assert.equal(rows[0]?.registrationNumber, "REG-1");
  assert.equal(rows[0]?.relationships.outbound, 1);
  assert.ok(calls.every((call) => !/\btmt_(?:concept|relationship|regno|atc|nlem|mastertmt|subs|vtm|gp|gpu|gpp|tp|tpu|tpp)\b/.test(call.sql)));
  assert.ok(calls.every((call) => call.params.includes(release.tmtDatasetId)));
  assert.match(calls[0]!.sql, /tmt_dataset_concepts/);
  assert.match(calls[0]!.sql, /tmt_dataset_regno/);
  assert.match(calls[0]!.sql, /ORDER BY CASE WHEN c\.tmtid=\? THEN 0 ELSE 1 END, c\.tmtid/);
});

test("legacy TMT search keeps live tables when no release context is supplied", async () => {
  const calls: string[] = [];
  const pool = { query: async (sql: string) => { calls.push(sql); return [[], []]; } } as unknown as Pool;
  await searchTmt(pool, { tmtId: "565818" });
  assert.match(calls[0]!, /FROM tmt_concept c/);
  assert.doesNotMatch(calls[0]!, /tmt_dataset_/);
});

test("release-aware export hashes stale identical rows after a release switch without changing legacy hashes", () => {
  const candidate: ExportCandidateState & { row: unknown } = { facilityId: "f", mappingId: "m", mappingSource: "manual", mappingUpdatedAt: new Date("2026-01-01T00:00:00Z"), checkpointExportId: null, status: "mapped", standardValid: true, row: { tmtid: "1" } };
  const legacy = exportSnapshotHash("f", "all-mapped", [candidate]);
  assert.equal(exportSnapshotHash("f", "all-mapped", [candidate]), legacy);
  assert.notEqual(exportSnapshotHash("f", "all-mapped", [candidate], "release-a"), legacy);
  assert.notEqual(exportSnapshotHash("f", "all-mapped", [candidate], "release-a"), exportSnapshotHash("f", "all-mapped", [candidate], "release-b"));
});

test("versioned graph joins relationships and concepts inside one dataset", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [[], []]; } } as unknown as Pool;
  await loadDirectTmtRelationships(pool, "1", 10, release);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.params[0] === release.tmtDatasetId));
  assert.ok(calls.every((call) => call.sql.includes("tmt_dataset_relationships") && call.sql.includes("tmt_dataset_concepts")));
  assert.ok(calls.every((call) => !/\bFROM tmt_relationship\b|\bJOIN tmt_concept\b/.test(call.sql)));
});

test("TTMT search selects only the release dataset while legacy search stays unchanged", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [[], []]; } } as unknown as Pool;
  await searchTtmtStandards(pool, "drug", release);
  await searchTtmtStandards(pool, "drug");
  assert.match(calls[0]!.sql, /FROM ttmt_dataset_products/);
  assert.equal(calls[0]!.params[0], release.ttmtDatasetId);
  assert.match(calls[1]!.sql, /FROM ttmt_products/);
  assert.doesNotMatch(calls[1]!.sql, /dataset_id/);
});
