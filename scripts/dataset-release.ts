import type { RowDataPacket } from "mysql2/promise";
import { ACTIVE_STANDARD_RELEASE_POINTER_KEY } from "@/modules/standards/active-release";
import {
  approveStandardRelease,
  prepareBaselineDataset,
  prepareStandardReleaseCandidate,
  publishStandardRelease,
  rollbackStandardRelease,
} from "@/modules/standards/dataset-release";
import {
  parseDatasetReleaseCli,
  datasetReleaseReasonSha256,
  redactDatasetReleaseCliValue,
  runDatasetReleaseCli,
  type DatasetReleaseCliDependencies,
  type DatasetReleaseCliRequest,
} from "@/modules/standards/dataset-release-cli";
import { standardDatasetLifecycleStoresForPool } from "@/modules/standards/dataset-release-mysql";
import { createOperationalPool, inspectOperationalTarget } from "@/modules/phase7/database";
import { loadExplicitEnvFile } from "@/modules/phase7/env";

const request = parseDatasetReleaseCli(process.argv.slice(2));
loadExplicitEnvFile(request.envFile);
const pool = createOperationalPool(request.environment);
const stores = standardDatasetLifecycleStoresForPool(pool);

async function pointerStatus(): Promise<string | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT active_release_id FROM standard_dataset_pointers WHERE pointer_key=? LIMIT 1",
    [ACTIVE_STANDARD_RELEASE_POINTER_KEY],
  );
  return rows[0]?.active_release_id === undefined || rows[0]?.active_release_id === null
    ? null
    : String(rows[0].active_release_id);
}

async function readOperation(input: DatasetReleaseCliRequest, target: Awaited<ReturnType<typeof inspectOperationalTarget>>): Promise<unknown> {
  if (input.command === "preflight") {
    const migration0018Applied = target.appliedMigrations.includes("0018_versioned_standard_dataset_foundation.sql");
    return {
      migration0018Applied,
      activeReleaseId: migration0018Applied ? await pointerStatus() : null,
      maintenanceEnabled: target.maintenanceEnabled,
      serverVersion: target.serverVersion,
    };
  }
  const release = input.releaseId ? await stores.releases.loadRelease(input.releaseId) : null;
  const dataset = input.datasetId ? await stores.baseline.readCandidate(input.datasetId) : null;
  if (input.command === "verify" && release) {
    const bundle = await stores.releases.loadValidationBundle(release.tmtDatasetId, release.ttmtDatasetId);
    return {
      activeReleaseId: await pointerStatus(), release,
      validation: {
        policyVersion: bundle.validation.policyVersion,
        status: bundle.validation.status,
        evidenceSha256: bundle.validation.evidenceSha256,
        tmtManifestValid: bundle.tmtManifestValid,
        ttmtManifestValid: bundle.ttmtManifestValid,
        regNoConflictCount: bundle.regNoConflictCount,
        blockingInvariantCount: bundle.versionedBlockingInvariantCount,
        gpu764169Passed: bundle.versionedGpu764169Passed,
      },
    };
  }
  return { activeReleaseId: await pointerStatus(), release, dataset };
}

async function mutateOperation(input: DatasetReleaseCliRequest): Promise<unknown> {
  const auditContext = { actorUserId: input.actorUserId, reasonSha256: datasetReleaseReasonSha256(input.reason!) };
  if (input.command === "baseline" || input.command === "resume") {
    const inspection = await prepareBaselineDataset({
      datasetId: input.datasetId!, source: input.source!, sourceVersion: input.sourceVersion!,
      tmtSyncRunId: input.tmtSyncRunId, ttmtImportId: input.ttmtImportId, batchSize: input.batchSize,
    }, stores.baseline);
    return { datasetId: input.datasetId, inspection, auditContext };
  }
  if (input.command === "validate") {
    await prepareStandardReleaseCandidate({
      releaseId: input.releaseId!, tmtDatasetId: input.tmtDatasetId!, ttmtDatasetId: input.ttmtDatasetId!,
      actorUserId: input.actorUserId!,
    }, stores.releases);
  } else if (input.command === "approve") {
    await approveStandardRelease({ releaseId: input.releaseId!, actorUserId: input.actorUserId! }, stores.releases);
  } else if (input.command === "publish") {
    await publishStandardRelease({
      releaseId: input.releaseId!, expectedActiveReleaseId: input.expectedActiveReleaseId!, actorUserId: input.actorUserId!,
    }, stores.releases);
  } else if (input.command === "rollback") {
    await rollbackStandardRelease({
      releaseId: input.releaseId!, expectedActiveReleaseId: input.expectedActiveReleaseId!, actorUserId: input.actorUserId!,
    }, stores.releases);
  }
  return { releaseId: input.releaseId, auditContext };
}

const dependencies: DatasetReleaseCliDependencies = {
  inspectTarget: (input) => inspectOperationalTarget(pool, {
    environment: input.environment, executeRequested: input.execute, confirmDatabase: input.confirmDatabase,
  }),
  readActiveReleaseId: pointerStatus,
  read: readOperation,
  mutate: mutateOperation,
};

try {
  const result = await runDatasetReleaseCli(request, dependencies);
  console.log(JSON.stringify(redactDatasetReleaseCliValue(result)));
} finally {
  await pool.end();
}
