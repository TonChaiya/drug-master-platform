export type OperationalEnvironment = "local" | "production";

export interface OperationalTarget {
  environment: OperationalEnvironment;
  host: string;
  port: number;
  database: string;
  serverVersion: string;
  appliedMigrations: readonly string[];
  maintenanceEnabled: boolean;
  executeRequested: boolean;
  confirmDatabase?: string;
}

export class Phase7GuardError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Phase7GuardError";
  }
}

function refuse(code: string, message: string): never {
  throw new Phase7GuardError(code, message);
}

export function assertOperationalTarget(
  target: OperationalTarget,
  options: { forExecution: boolean; requiredMigrations: readonly string[]; requireMaintenance?: boolean },
): void {
  if (target.database.toLowerCase() === "jhcisdb") refuse("DATABASE_FORBIDDEN", "jhcisdb is never an operational target");

  if (target.environment === "production") {
    if (!target.host.toLowerCase().endsWith(".tidbcloud.com")) refuse("PRODUCTION_HOST_INVALID", "Production host is not TiDB Cloud");
    if (target.port !== 4000) refuse("PRODUCTION_PORT_INVALID", "Production port must be 4000");
    if (target.database !== "drug_master_platform") refuse("PRODUCTION_DATABASE_INVALID", "Production database identity mismatch");
    if (!/TiDB/i.test(target.serverVersion)) refuse("PRODUCTION_ENGINE_INVALID", "Production server is not TiDB");
  } else {
    if (target.host !== "127.0.0.1" && target.host !== "localhost") refuse("LOCAL_HOST_INVALID", "Local operation must use localhost");
    if (!/^drug_master_[a-z0-9_]*test$/.test(target.database)) refuse("LOCAL_DATABASE_INVALID", "Local operation requires a guarded test database");
  }

  for (const migration of options.requiredMigrations) {
    if (!target.appliedMigrations.includes(migration)) refuse("MIGRATION_REQUIRED", `Required migration is missing: ${migration}`);
  }
  if (options.requireMaintenance !== false && !target.maintenanceEnabled) refuse("MAINTENANCE_REQUIRED", "Maintenance mode must be enabled");
  if (!options.forExecution) return;
  if (!target.executeRequested) refuse("EXECUTE_FLAG_REQUIRED", "Explicit --execute is required");
  if (target.confirmDatabase !== target.database) refuse("DATABASE_CONFIRMATION_MISMATCH", "Database confirmation does not match");
}
