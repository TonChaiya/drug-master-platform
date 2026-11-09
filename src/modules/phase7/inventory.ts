export interface Phase7PreflightInput {
  missingMigrations: string[];
  maintenanceEnabled: boolean;
  credentialPresent: boolean;
  tmtTablesPresent: boolean;
  ttmtTablesPresent: boolean;
  masterTtmtPresent: boolean;
  featureFlags: { browser: boolean; mapping: boolean; catalog: boolean; export: boolean };
}

export function evaluatePhase7Preflight(input: Phase7PreflightInput): { ready: boolean; blockers: string[] } {
  const blockers = input.missingMigrations.map((migration) => `MIGRATION_MISSING:${migration}`);
  if (!input.maintenanceEnabled) blockers.push("MAINTENANCE_OFF");
  if (!input.credentialPresent) blockers.push("TMT_CREDENTIAL_MISSING");
  if (!input.tmtTablesPresent) blockers.push("TMT_V2_TABLES_MISSING");
  if (!input.ttmtTablesPresent) blockers.push("TTMT_V2_TABLES_MISSING");
  if (!input.masterTtmtPresent) blockers.push("MASTER_TTMT_FILE_MISSING");
  if (Object.values(input.featureFlags).some(Boolean)) blockers.push("V2_FEATURE_FLAG_ALREADY_ENABLED");
  return { ready: blockers.length === 0, blockers };
}
