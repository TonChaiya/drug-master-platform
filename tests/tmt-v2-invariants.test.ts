import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, test } from "vitest";
import type { Pool } from "mysql2/promise";
import { buildTmtInvariantReport, verifyTmtGpuAcceptance } from "@/modules/tmt/invariants";
import { createIntegrationTestPool, dbIntegrationTestsEnabled, integrationTestDbConfig } from "./helpers/db-integration";

let pool: Pool;
const version = "fixture-v1";
const timestamp = new Date("2026-11-04T00:00:00.000Z");

describe.runIf(dbIntegrationTestsEnabled()).sequential("TMT v2 invariant report on isolated local MySQL", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool(integrationTestDbConfig());
    await pool.query("DELETE FROM tmt_relationship");
    await pool.query("DELETE FROM tmt_nlem");
    await pool.query("DELETE FROM tmt_mastertmt");
    await pool.query("DELETE FROM tmt_tpu");
    await pool.query("DELETE FROM tmt_gpp");
    await pool.query("DELETE FROM tmt_gp");
    await pool.query("DELETE FROM tmt_gpu");
    await pool.query("DELETE FROM tmt_concept");

    const levelMetadata = [version, version, timestamp];
    await pool.execute("INSERT INTO tmt_gpu (gpuid,fsn,change_date,source_version,last_seen_version,synced_at) VALUES (764169,'clinical name','2026-01-01',?,?,?)", levelMetadata);
    await pool.execute("INSERT INTO tmt_gp (gpid,fsn,change_date,source_version,last_seen_version,synced_at) VALUES (100,'parent','2026-01-01',?,?,?)", levelMetadata);
    await pool.execute("INSERT INTO tmt_gpp (gppid,fsn,change_date,source_version,last_seen_version,synced_at) VALUES (300,'pack','2026-01-01',?,?,?)", levelMetadata);
    await pool.execute("INSERT INTO tmt_tpu (tpuid,fsn,manufacturer,change_date,source_version,last_seen_version,synced_at) VALUES (200,'trade one','maker','2026-01-01',?,?,?),(201,'trade two','maker','2026-01-01',?,?,?),(556,'orphan tpu','maker','2026-01-01',?,?,?)", [...levelMetadata, ...levelMetadata, ...levelMetadata]);
    await pool.execute(
      "INSERT INTO tmt_concept (tmtid,fsn,change_date,level_name,source_version,last_seen_version,synced_at) VALUES (764169,'clinical name (GPU)','2026-01-01','gpu',?,?,?),(100,'parent (GP)','2026-01-01','gp',?,?,?),(200,'trade one (TPU)','2026-01-01','tpu',?,?,?),(201,'trade two (TPU)','2026-01-01','tpu',?,?,?),(202,'missing endpoint row (TPU)','2026-01-01','tpu',?,?,?),(300,'pack (GPP)','2026-01-01','gpp',?,?,?),(999,'future','2026-01-01','future-level',?,?,?)",
      [...levelMetadata, ...levelMetadata, ...levelMetadata, ...levelMetadata, ...levelMetadata, ...levelMetadata, ...levelMetadata],
    );
    await pool.execute(
      "INSERT INTO tmt_mastertmt (tpucode,fsn,status,source_version,last_seen_version,synced_at) VALUES (200,'trade one',0,?,?,?),(201,'trade two',0,?,?,?),(555,'missing tpu',7,?,?,?)",
      [...levelMetadata, ...levelMetadata, ...levelMetadata],
    );
    await pool.execute(
      "INSERT INTO tmt_relationship (concept1,concept2,change_date,level_name1,level_name2,source_version,last_seen_version,synced_at) VALUES (100,764169,'2026-01-01','gp','gpu',?,?,?),(764169,200,'2026-01-01','gpu','tpu',?,?,?),(764169,201,'2026-01-01','gpu','tpu',?,?,?),(764169,300,'2026-01-01','gpu','gpp',?,?,?),(999,999,'2026-01-01','future-level','future-level',?,?,?),(8888,9999,'2026-01-01','gp','gpu',?,?,?)",
      [...levelMetadata, ...levelMetadata, ...levelMetadata, ...levelMetadata, ...levelMetadata, ...levelMetadata],
    );
    await pool.execute(
      "INSERT INTO tmt_nlem (tpuid,fsn,nlem,change_date,source_version,synced_at) VALUES (200,'trade one','ED','2026-01-01',?,?),(200,'trade one','NED','2026-01-01',?,?)",
      [version, timestamp, version, timestamp],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    for (const table of ["tmt_relationship", "tmt_nlem", "tmt_mastertmt", "tmt_tpu", "tmt_gpp", "tmt_gp", "tmt_gpu", "tmt_concept"]) await pool.query(`DELETE FROM ${table}`);
    await pool.end();
  });

  test("report contains bounded counts for structural and data-quality failures", async () => {
    const report = await buildTmtInvariantReport(pool, {
      optionalFailures: [{ endpoint: "imagelist", errorCode: "TMT_HTTP_500" }],
      versionDrift: false,
      exampleLimit: 2,
    });
    assert.equal(report.countsByLevel.gpu, 1);
    assert.equal(report.tableCounts.tmt_gpu, 1);
    assert.ok(report.missingConceptCounterparts.count >= 1);
    assert.ok(report.missingEndpointCounterparts.count >= 1);
    assert.equal(report.masterTmtMissingTpu.count, 1);
    assert.equal(report.tpuMissingMasterTmt.count, 1);
    assert.equal(report.danglingRelationshipConcepts.count, 1);
    assert.equal(report.unknownLevels.count, 1);
    assert.equal(report.unknownMasterStatuses.count, 1);
    assert.equal(report.selfRelationships.count, 1);
    assert.equal(report.enrichmentConflicts.nlem.count, 1);
    assert.equal(report.optionalFailures.length, 1);
    assert.ok(report.unknownLevels.examples.length <= 2);
  });

  test("764169 acceptance follows API edge direction and verifies related TPU storage", async () => {
    const acceptance = await verifyTmtGpuAcceptance(pool, "764169");
    assert.equal(acceptance.gpu?.gpuid, "764169");
    assert.equal(acceptance.concept?.levelName, "gpu");
    assert.equal(acceptance.inboundGp, 1);
    assert.equal(acceptance.outboundTpu, 2);
    assert.equal(acceptance.outboundGpp, 1);
    assert.deepEqual(acceptance.relatedTpuIds, ["200", "201"]);
    assert.equal(acceptance.relatedTpuPresent, 2);
    assert.equal(acceptance.relatedMasterTmtPresent, 2);
    assert.equal(acceptance.relatedConceptPresent, 2);
    assert.deepEqual(acceptance.masterStatuses, [{ tpucode: "200", status: 0 }, { tpucode: "201", status: 0 }]);
  });
});
