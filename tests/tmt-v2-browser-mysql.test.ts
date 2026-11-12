import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, test } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { searchTmt } from "@/modules/tmt/search";
import { getTmtConceptDetail } from "@/modules/tmt/detail";
import { loadDirectTmtRelationships, traverseTmtGraph } from "@/modules/tmt/graph";
import { createIntegrationTestPool, dbIntegrationTestsEnabled, integrationTestDbConfig } from "./helpers/db-integration";
import { GPU_ID, TPU_IDS, resetTmtBrowserFixture } from "./helpers/tmt-v2-browser-fixture";

let pool: Pool;

describe.runIf(dbIntegrationTestsEnabled()).sequential("TMT v2 browser on isolated local MySQL", () => {
  beforeAll(async () => {
    const config = integrationTestDbConfig();
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 3307);
    assert.equal(config.database, "drug_master_tmt_v2_browser_test");
    pool = createIntegrationTestPool(config);
    await resetTmtBrowserFixture(pool);
  });

  afterAll(async () => {
    if (!pool) return;
    await resetTmtBrowserFixture(pool);
    await pool.end();
  });

  test("exact code ranks before its numeric prefix matches and carries relationship truth", async () => {
    const rows = await searchTmt(pool, { query: GPU_ID, limit: 20 });
    assert.equal(rows[0]?.tmtId, GPU_ID);
    assert.equal(rows[0]?.level, "gpu");
    assert.equal(rows[0]?.endpointFsn, "lidocaine hydrochloride 400 mg/20 mL solution for injection, 20 mL vial");
    assert.equal(rows[0]?.relationships.inboundByLevel.gp, 1);
    assert.equal(rows[0]?.relationships.outboundByLevel.tpu, 9);
    assert.equal(rows[0]?.relationships.outboundByLevel.gpp, 3);
    assert.equal(rows[0]?.mappingEligible, false);
    assert.ok(rows.some((row) => row.tmtId === "7641690"));
  });

  test("prefix, normalized FSN, level, manufacturer, status, eligibility, and enrichment filters are bounded", async () => {
    assert.ok((await searchTmt(pool, { query: "7641", limit: 20 })).some((row) => row.tmtId === GPU_ID));
    assert.equal((await searchTmt(pool, { query: "lidocaine hydrochloride 400", level: "gpu", limit: 20 }))[0]?.tmtId, GPU_ID);
    assert.equal((await searchTmt(pool, { manufacturer: "บริษัท แอคมี", limit: 20 }))[0]?.tmtId, TPU_IDS[0]);
    assert.equal((await searchTmt(pool, { query: "999001", status: "cancelled", limit: 20 }))[0]?.status, "cancelled");
    assert.equal((await searchTmt(pool, { query: "565818", status: "active", mappingEligible: true, limit: 20 }))[0]?.mappingEligible, true);
    assert.equal((await searchTmt(pool, { query: "999002", mappingEligible: false, limit: 20 }))[0]?.status, "unknown");
    assert.equal((await searchTmt(pool, { registration: "1A 123", limit: 20 }))[0]?.tmtId, TPU_IDS[0]);
    assert.equal((await searchTmt(pool, { atc: "N01BB", limit: 20 }))[0]?.tmtId, TPU_IDS[0]);
    assert.equal((await searchTmt(pool, { nlem: "ED", limit: 20 }))[0]?.tmtId, TPU_IDS[0]);
    assert.equal((await searchTmt(pool, { query: "lidocaine", limit: 2 })).length, 2);
  });

  test("independent Lidocaine fields combine with AND and keep q compatibility", async () => {
    const rows = await searchTmt(pool, {
      tmtId: "764182",
      fsn: "lidocaine hydrochloride",
      genericName: "lidocaine hydrochloride",
      tradeName: "lidocaine hydrochloride",
      manufacturer: "องค์การเภสัชกรรม",
      level: "tpu",
      status: "active",
      mappingEligible: true,
      limit: 20,
    });
    assert.deepEqual(rows.map((row) => row.tmtId), ["764182"]);
    assert.equal(rows[0]?.tradeName, "LIDOCAINE HYDROCHLORIDE");
    assert.equal(rows[0]?.manufacturer, "องค์การเภสัชกรรม");
    assert.equal((await searchTmt(pool, { tmtId: "764182", manufacturer: "ไม่ตรง", limit: 20 })).length, 0);
    assert.ok((await searchTmt(pool, { fsn: "lidocaine", limit: 20 })).length > 0);
    assert.ok((await searchTmt(pool, { genericName: "lidocaine hydrochloride", limit: 20 })).length > 0);
    assert.equal((await searchTmt(pool, { query: "764182", limit: 20 }))[0]?.tmtId, "764182");
  });

  test("search exposes latest RegNo without choosing conflicts or inventing missing values", async () => {
    const conflict = (await searchTmt(pool, { query: TPU_IDS[0], limit: 20 }))[0];
    assert.equal(conflict?.registrationNumber, null);
    assert.equal(conflict?.registrationConflict, true);

    const single = (await searchTmt(pool, { query: TPU_IDS[1], limit: 20 }))[0];
    assert.equal(single?.registrationNumber, "1A 200/67");
    assert.equal(single?.registrationConflict, false);

    const missing = (await searchTmt(pool, { query: TPU_IDS[2], limit: 20 }))[0];
    assert.equal(missing?.registrationNumber, null);
    assert.equal(missing?.registrationConflict, false);
  });

  test("empty search and unknown stored levels are safe", async () => {
    assert.deepEqual(await searchTmt(pool, { query: "does-not-exist", limit: 20 }), []);
    const unknown = await searchTmt(pool, { query: "999999", limit: 20 });
    assert.equal(unknown[0]?.level, "future-level");
    assert.ok(unknown[0]?.dataQualityWarnings.includes("พบ level ที่ระบบยังไม่รู้จัก"));
  });

  test("exact concept and both relationship directions use existing keys", async () => {
    const [conceptPlan] = await pool.query<RowDataPacket[]>("EXPLAIN SELECT * FROM tmt_concept WHERE tmtid=?", [GPU_ID]);
    assert.equal(conceptPlan[0]?.key, "PRIMARY");
    const [outboundPlan] = await pool.query<RowDataPacket[]>("EXPLAIN SELECT * FROM tmt_relationship WHERE concept1=?", [GPU_ID]);
    assert.equal(outboundPlan[0]?.key, "PRIMARY");
    const [inboundPlan] = await pool.query<RowDataPacket[]>("EXPLAIN SELECT * FROM tmt_relationship WHERE concept2=?", [GPU_ID]);
    assert.equal(inboundPlan[0]?.key, "idx_tmt_relationship_reverse");
  });

  test("concept detail preserves direct direction and the verified 764169 graph", async () => {
    const detail = await getTmtConceptDetail(pool, GPU_ID, { graphDepth: 2, maxNodes: 50 });
    assert.ok(detail);
    assert.equal(detail?.concept.tmtId, GPU_ID);
    assert.equal(detail?.direct.inbound.filter((edge) => edge.relatedLevel === "gp").length, 1);
    assert.equal(detail?.direct.outbound.filter((edge) => edge.relatedLevel === "tpu").length, 9);
    assert.equal(detail?.direct.outbound.filter((edge) => edge.relatedLevel === "gpp").length, 3);
    assert.equal(detail?.relatedTpu.length, 9);
    assert.ok(detail?.relatedTpu.every((row) => row.status === "active" && row.mappingEligible));
    assert.equal(detail?.relatedTpu.find((row) => row.tmtId === TPU_IDS[0])?.registrationConflict, true);
    assert.equal(detail?.relatedTpu.find((row) => row.tmtId === TPU_IDS[1])?.registrationNumber, "1A 200/67");
    assert.equal(detail?.relatedTpu.find((row) => row.tmtId === TPU_IDS[2])?.registrationNumber, null);
    assert.ok(detail?.warnings.includes("ไม่พบรายละเอียด concept ในข้อมูล TMT ที่ซิงก์ปัจจุบัน"));

    const direct = await loadDirectTmtRelationships(pool, GPU_ID, 50);
    assert.ok(direct.outbound.every((edge) => edge.concept1 === GPU_ID));
    assert.ok(direct.inbound.every((edge) => edge.concept2 === GPU_ID));
    assert.ok(direct.outbound.some((edge) => edge.relatedConcept === null));
  });

  test("TPU detail exposes MasterTMT and latest temporal conflicts without choosing a winner", async () => {
    const detail = await getTmtConceptDetail(pool, TPU_IDS[0], { graphDepth: 1, maxNodes: 30 });
    assert.equal(detail?.masterTmt?.status, 0);
    assert.equal(detail?.nlem?.changeDate, "2026-02-01");
    assert.deepEqual(detail?.nlem?.values, ["NED"]);
    assert.equal(detail?.atc?.conflict, true);
    assert.deepEqual(detail?.atc?.values, ["N01BB02", "N01BB52"]);
    assert.equal(detail?.regno?.conflict, true);
    assert.deepEqual(detail?.regno?.values, ["1A 124/67", "1A 125/67"]);
    assert.ok(detail?.warnings.includes("พบหลายค่า ATC ในวันที่ล่าสุด"));
    assert.ok(detail?.warnings.includes("พบหลายเลขทะเบียนยาในวันที่ล่าสุด"));

    const missing = await getTmtConceptDetail(pool, TPU_IDS[2], { graphDepth: 1, maxNodes: 30 });
    assert.equal(missing?.nlem, null);
    assert.equal(missing?.atc, null);
    assert.equal(missing?.regno, null);
  });

  test("graph traversal bounds multi-parent, self, cycles, dangling nodes, and same-level pack edges", async () => {
    const multiParent = await loadDirectTmtRelationships(pool, "2003", 20);
    assert.deepEqual(multiParent.inbound.map((edge) => edge.relatedId), ["2001", "2002"]);

    const graph = await traverseTmtGraph(pool, "3001", { maxDepth: 4, maxNodes: 3 });
    assert.ok(graph.nodes.length <= 3);
    assert.ok(graph.edges.length <= 3);
    assert.ok(graph.edges.some((edge) => edge.concept1 === "3001" && edge.concept2 === "3001"));
    assert.ok(graph.edges.some((edge) => edge.levelName1 === "gpp" && edge.levelName2 === "gpp"));

    const tpp = await loadDirectTmtRelationships(pool, "4001", 20);
    assert.ok(tpp.outbound.some((edge) => edge.levelName1 === "tpp" && edge.levelName2 === "tpp"));

    const shallow = await traverseTmtGraph(pool, GPU_ID, { maxDepth: 1, maxNodes: 10 });
    assert.ok(shallow.nodes.every((node) => node.depth <= 1));
    assert.ok(shallow.nodes.length <= 10);
  });
});
