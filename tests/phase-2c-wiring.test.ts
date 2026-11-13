import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("mapping flag-on paths carry one explicit release into versioned readers", () => {
  const resolver = source("src/modules/mappings/v2.ts");
  const consumer = source("src/modules/mappings/v2-consumer.ts");
  const worklist = source("src/modules/mappings/v2-worklist.ts");
  assert.match(resolver, /eq\(tmtDatasetConcepts\.datasetId, release\.tmtDatasetId\)/);
  assert.match(resolver, /eq\(ttmtDatasetProducts\.datasetId, release\.ttmtDatasetId\)/);
  assert.match(consumer, /loadVersionedMappedStandardsV2\(identities, tmtCodes, ttmtCodes, database, release\)/);
  assert.match(worklist, /loadMappedStandardsV2\(identities, db, release\)/);
  assert.match(worklist, /WHERE c\.dataset_id=\$\{release\.tmtDatasetId\}/);
  assert.match(worklist, /WHERE p\.dataset_id=\$\{release\.ttmtDatasetId\}/);
});

test("download locks the pointer before candidates and hashes the resolved release", () => {
  const service = source("src/modules/exports/service.ts");
  const lock = service.indexOf("readLockedActiveStandardRelease(tx)");
  const build = service.indexOf("exportCandidateBuilder(release)", lock);
  const consume = service.indexOf(".update(exportPreviewTokens)", lock);
  assert.ok(lock >= 0 && build > lock && consume > build);
  assert.match(service, /exportSnapshotHash\(options\.facilityId, options\.selection, candidates, release\?\.releaseId\)/);
  assert.match(service, /throw new ExportPreviewStaleError\(\);[\s\S]*\.update\(exportPreviewTokens\)/);
});
