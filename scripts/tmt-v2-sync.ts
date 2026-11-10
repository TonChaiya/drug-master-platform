import { parseArgs } from "node:util";
import { z } from "zod";
import { resolveTmtCredentialsFromPool } from "@/modules/standards/tmt-credentials";
import { buildTmtInvariantReport, verifyTmtGpuAcceptance } from "@/modules/tmt/invariants";
import { TmtSyncRepository } from "@/modules/tmt/persistence";
import { createCredentialTmtSyncSource, resumeTmtSyncRun, runIncrementalTmtSync, runInitialTmtSync, runUnverifiedInitialTmtSync } from "@/modules/tmt/sync";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { assertOperationalTarget } from "@/modules/phase7/guards";
import { loadExplicitEnvFile } from "@/modules/phase7/env";
import { runOperationalTmtSync } from "@/modules/phase7/tmt-runner";

const args = parseArgs({ options: {
  environment: { type: "string" }, "env-file": { type: "string" }, mode: { type: "string" },
  "run-id": { type: "string" }, "dry-run": { type: "boolean" }, execute: { type: "boolean" },
  "confirm-db": { type: "string" }, "started-by": { type: "string" },
}, strict: true });
loadExplicitEnvFile(args.values["env-file"]);
const environment = z.enum(["local", "production"]).parse(args.values.environment);
const mode = z.enum(["full", "full-unverified", "incremental", "resume"]).parse(args.values.mode);
const execute = args.values.execute === true;
if (execute && args.values["dry-run"] === true) throw new Error("Choose --dry-run or --execute, not both");
const startedBy = args.values["started-by"] ? z.string().uuid().parse(args.values["started-by"]) : null;

const pool = createOperationalPool(environment);
try {
  const target = await inspectOperationalTarget(pool, { environment, executeRequested: execute, confirmDatabase: args.values["confirm-db"] });
  assertOperationalTarget(target, { forExecution: execute, requiredMigrations: ["0014_tmt_data_model_v2.sql", "0015_ttmt_data_model_v2.sql", "0016_mapping_v2_identity.sql"] });
  const credentials = await resolveTmtCredentialsFromPool(pool);
  const source = credentials ? createCredentialTmtSyncSource(credentials) : null;
  const store = new TmtSyncRepository(pool);
  const validateInvariants = async (requireGpuAcceptance: boolean) => {
    const report = await buildTmtInvariantReport(pool);
    const blocking = [
      report.missingConceptCounterparts, report.missingEndpointCounterparts, report.levelMismatch,
      report.masterTmtMissingTpu, report.masterTmtMissingConcept, report.tpuMissingMasterTmt,
      report.unknownLevels, report.duplicateRelationshipPairs, report.unknownMasterStatuses,
    ].reduce((sum, issue) => sum + issue.count, 0);
    if (blocking > 0) throw new Error(`TMT invariants failed with ${blocking} blocking rows`);
    if (requireGpuAcceptance) {
      const gpu = await verifyTmtGpuAcceptance(pool, "764169");
      const relatedComplete = gpu.outboundTpu > 0
        && gpu.relatedTpuPresent === gpu.outboundTpu
        && gpu.relatedMasterTmtPresent === gpu.outboundTpu
        && gpu.relatedConceptPresent === gpu.outboundTpu;
      if (!gpu.gpu || gpu.concept?.levelName !== "gpu" || !relatedComplete || !gpu.masterStatuses.some((row) => row.status === 0)) {
        throw new Error("TMT GPU 764169 acceptance failed");
      }
    }
    return [
      report.fsnUnexpectedMismatch, report.danglingRelationshipConcepts, report.selfRelationships,
      report.enrichmentConflicts.nlem, report.enrichmentConflicts.atc, report.enrichmentConflicts.regno,
    ].reduce((sum, issue) => sum + issue.count, 0) + report.optionalFailures.length;
  };
  const common = {
    source: source!, store, now: () => new Date(), sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    startedBy,
    invariantCheck: async () => ({ warningsCount: await validateInvariants(false) }),
  };
  const result = await runOperationalTmtSync({ mode, runId: args.values["run-id"], dryRun: !execute, credentialPresent: credentials !== null }, {
    full: () => runInitialTmtSync({ ...common, historyStart: "2013-01-01" }),
    fullUnverified: () => runUnverifiedInitialTmtSync({
      ...common,
      historyStart: "2013-01-01",
      invariantCheck: async () => ({ warningsCount: await validateInvariants(true) }),
    }),
    incremental: () => runIncrementalTmtSync(common),
    resume: (runId) => resumeTmtSyncRun({ ...common, runId }),
  });
  console.log(JSON.stringify({ environment, database: target.database, maintenance: target.maintenanceEnabled, ...result }));
  if (result.result) {
    const expectedUnverified = mode === "full-unverified" && result.result.status === "unverified" && !result.result.coreReady;
    if (!expectedUnverified && (!result.result.coreReady || result.result.status !== "succeeded")) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
