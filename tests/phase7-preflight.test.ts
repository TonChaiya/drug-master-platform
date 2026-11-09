import assert from "node:assert/strict";
import { test } from "vitest";
import { evaluatePhase7Preflight } from "@/modules/phase7/inventory";

test("Phase 7 preflight reports every blocker and returns not ready", () => {
  const report = evaluatePhase7Preflight({
    missingMigrations: ["0016_mapping_v2_identity.sql"], maintenanceEnabled: false, credentialPresent: false,
    tmtTablesPresent: false, ttmtTablesPresent: true, masterTtmtPresent: false,
    featureFlags: { browser: false, mapping: false, catalog: false, export: false },
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((value) => value.includes("0016")));
  assert.ok(report.blockers.includes("MAINTENANCE_OFF"));
  assert.ok(report.blockers.includes("TMT_CREDENTIAL_MISSING"));
  assert.ok(report.blockers.includes("MASTER_TTMT_FILE_MISSING"));
});

test("Phase 7 preflight is ready only when operational prerequisites exist and flags remain off", () => {
  const report = evaluatePhase7Preflight({
    missingMigrations: [], maintenanceEnabled: true, credentialPresent: true,
    tmtTablesPresent: true, ttmtTablesPresent: true, masterTtmtPresent: true,
    featureFlags: { browser: false, mapping: false, catalog: false, export: false },
  });
  assert.deepEqual(report, { ready: true, blockers: [] });
});
