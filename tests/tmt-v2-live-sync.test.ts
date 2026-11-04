import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { afterAll, beforeAll, describe, test } from "vitest";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { buildTmtInvariantReport, verifyTmtGpuAcceptance, type TmtInvariantReport } from "@/modules/tmt/invariants";
import { TmtSyncRepository } from "@/modules/tmt/persistence";
import { createCredentialTmtSyncSource, runIncrementalTmtSync, runInitialTmtSync } from "@/modules/tmt/sync";
import { createIntegrationTestPool, dbIntegrationTestsEnabled, integrationTestDbConfig } from "./helpers/db-integration";

const enabled = dbIntegrationTestsEnabled() && process.env.ALLOW_TMT_LIVE_SYNC === "1";
let pool: Pool;

const resetOrder = [
  "tmt_sync_checkpoints", "tmt_version", "tmt_sync_runs", "tmt_relationship", "tmt_concept", "tmt_mastertmt",
  "tmt_regno", "tmt_atc", "tmt_nlem", "tmt_tpp", "tmt_tpu", "tmt_tp", "tmt_gpp", "tmt_gpu", "tmt_gp", "tmt_vtm", "tmt_subs",
] as const;

function warningCount(report: TmtInvariantReport): number {
  return [
    report.missingConceptCounterparts, report.missingEndpointCounterparts, report.levelMismatch, report.fsnUnexpectedMismatch,
    report.masterTmtMissingTpu, report.masterTmtMissingConcept, report.tpuMissingMasterTmt, report.danglingRelationshipConcepts,
    report.unknownLevels, report.selfRelationships, report.duplicateRelationshipPairs, report.unknownMasterStatuses,
    report.enrichmentConflicts.nlem, report.enrichmentConflicts.atc, report.enrichmentConflicts.regno,
  ].reduce((sum, issue) => sum + issue.count, 0);
}

async function counts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of resetOrder.filter((name) => !name.startsWith("tmt_sync_"))) {
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${table}`);
    result[table] = Number(row?.total ?? 0);
  }
  return result;
}

const credentialSchema = z.object({
  baseUrl: z.string().url().startsWith("https://"),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

async function credentialsFromApprovedSources(environment: Record<string, string | undefined>): Promise<z.infer<typeof credentialSchema>> {
  const direct = credentialSchema.safeParse({
    baseUrl: environment.TMT_API_BASE?.trim().replace(/\/+$/, ""),
    username: environment.TMT_API_USER?.trim(),
    password: environment.TMT_API_PASSWORD,
  });
  if (direct.success) return direct.data;

  const host = environment.DB_HOST?.trim();
  const database = environment.DB_DATABASE?.trim();
  assert.ok(host && host !== "localhost" && host !== "127.0.0.1", "production credential lookup requires a verified non-local host");
  assert.ok(database && !database.endsWith("test"), "production credential lookup cannot target a test database");
  assert.equal(environment.DB_SSL, "true");
  const connection = await mysql.createConnection({
    host,
    port: Number(environment.DB_PORT),
    user: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    database,
    ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  let encrypted = "";
  try {
    const [[identity]] = await connection.query<RowDataPacket[]>("SELECT DATABASE() AS database_name,VERSION() AS server_version");
    assert.equal(identity?.database_name, database);
    assert.match(String(identity?.server_version ?? ""), /TiDB/i);
    const [settings] = await connection.execute<RowDataPacket[]>("SELECT value_encrypted FROM app_settings WHERE setting_key='tmt_api' LIMIT 1");
    encrypted = String(settings[0]?.value_encrypted ?? "");
    assert.ok(encrypted, "stored TMT credential was not found");
  } finally {
    await connection.end();
  }

  const previousKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = environment.APP_ENCRYPTION_KEY;
  try {
    return credentialSchema.parse(JSON.parse(decryptSecret(encrypted)));
  } finally {
    if (previousKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previousKey;
  }
}

describe.runIf(enabled).sequential("controlled live TMT v2 sync into isolated local MySQL", () => {
  beforeAll(async () => {
    const config = integrationTestDbConfig();
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.database, "drug_master_tmt_v2_sync_test");
    pool = createIntegrationTestPool(config, { connectionLimit: 4 });
    const [journal] = await pool.query<RowDataPacket[]>("SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1");
    assert.equal(journal[0]?.filename, "0015_ttmt_data_model_v2.sql");
  });

  afterAll(async () => { if (pool) await pool.end(); });

  test("full local backfill, 764169 graph, idempotent overlap, and incremental cursors", async () => {
    for (const table of resetOrder) await pool.query(`DELETE FROM ${table}`);
    const credentialPath = process.env.TMT_V2_SYNC_CREDENTIAL_FILE;
    assert.ok(credentialPath, "TMT_V2_SYNC_CREDENTIAL_FILE is required");
    const environment = parseEnv(await readFile(credentialPath, "utf8"));
    const credentials = await credentialsFromApprovedSources(environment);

    const repository = new TmtSyncRepository(pool);
    const source = createCredentialTmtSyncSource(credentials);
    let latestReport: TmtInvariantReport | null = null;
    const started = Date.now();
    const full = await runInitialTmtSync({
      source,
      store: repository,
      now: () => new Date(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      random: Math.random,
      invariantCheck: async () => {
        latestReport = await buildTmtInvariantReport(pool);
        return { warningsCount: warningCount(latestReport) };
      },
    });
    if (!full.coreReady) console.log(JSON.stringify({ liveTmtV2Failure: { runId: full.runId, status: full.status, errorCode: full.errorCode } }));
    assert.equal(full.coreReady, true);
    assert.equal(full.status, "succeeded");
    assert.ok(latestReport);

    const acceptance = await verifyTmtGpuAcceptance(pool, "764169");
    assert.equal(acceptance.gpu?.gpuid, "764169");
    assert.equal(acceptance.concept?.levelName, "gpu");
    assert.equal(acceptance.relatedTpuPresent, acceptance.outboundTpu);
    assert.equal(acceptance.relatedMasterTmtPresent, acceptance.outboundTpu);
    assert.equal(acceptance.relatedConceptPresent, acceptance.outboundTpu);

    const beforeIncremental = await counts();
    const incremental = await runIncrementalTmtSync({
      source,
      store: repository,
      now: () => new Date(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      random: Math.random,
      invariantCheck: async () => ({ warningsCount: 0 }),
    });
    assert.equal(incremental.coreReady, true);
    const afterIncremental = await counts();
    for (const [table, before] of Object.entries(beforeIncremental)) assert.ok((afterIncremental[table] ?? 0) >= before, `${table} regressed`);

    console.log(JSON.stringify({
      liveTmtV2Summary: {
        version: full.version,
        range: ["2013-01-01", new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })],
        durationMs: Date.now() - started,
        coreReady: full.coreReady,
        optionalWarnings: full.optionalWarnings,
        totalAttempts: full.totalAttempts,
        receivedRows: full.receivedRows,
        uniqueRows: full.uniqueRows,
        writtenRows: full.writtenRows,
        duplicateRows: full.duplicateRows,
        counts: afterIncremental,
        acceptance764169: acceptance,
        invariantWarningCount: latestReport ? warningCount(latestReport) : null,
        incremental: { coreReady: incremental.coreReady, receivedRows: incremental.receivedRows, writtenRows: incremental.writtenRows },
      },
    }));
  }, 1_800_000);

  test("reports bounded invariant counts from the retained local backfill", async () => {
    const [failures] = await pool.query<RowDataPacket[]>(
      "SELECT endpoint,error_code FROM tmt_sync_checkpoints WHERE status='failed' AND endpoint IN ('atc','imagelist') ORDER BY endpoint,window_begin",
    );
    const report = await buildTmtInvariantReport(pool, {
      optionalFailures: failures.map((row) => ({ endpoint: String(row.endpoint), errorCode: String(row.error_code) })),
      exampleLimit: 5,
    });
    console.log(JSON.stringify({ liveTmtV2InvariantCounts: {
      countsByLevel: report.countsByLevel,
      missingConceptCounterparts: report.missingConceptCounterparts.count,
      missingEndpointCounterparts: report.missingEndpointCounterparts.count,
      levelMismatch: report.levelMismatch.count,
      fsnUnexpectedMismatch: report.fsnUnexpectedMismatch.count,
      masterTmtMissingTpu: report.masterTmtMissingTpu.count,
      masterTmtMissingConcept: report.masterTmtMissingConcept.count,
      tpuMissingMasterTmt: report.tpuMissingMasterTmt.count,
      danglingRelationshipConcepts: report.danglingRelationshipConcepts.count,
      unknownLevels: report.unknownLevels.count,
      unknownMasterStatuses: report.unknownMasterStatuses.count,
      selfRelationships: report.selfRelationships.count,
      duplicateRelationshipPairs: report.duplicateRelationshipPairs.count,
      nlemConflicts: report.enrichmentConflicts.nlem.count,
      atcConflicts: report.enrichmentConflicts.atc.count,
      regnoConflicts: report.enrichmentConflicts.regno.count,
      optionalFailures: report.optionalFailures.length,
      versionDrift: report.versionDrift,
    } }));
    assert.equal(report.versionDrift, false);
  }, 60_000);
});
