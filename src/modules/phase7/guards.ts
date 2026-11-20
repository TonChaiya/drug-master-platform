import { GuardedTargetClassificationError, classifyGuardedTarget } from "./target-classification";

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
  rehearsalIntent?: boolean;
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
  try {
    classifyGuardedTarget({
      environment: target.environment, host: target.host, port: target.port, database: target.database,
      serverVersion: target.serverVersion, rehearsalIntent: target.rehearsalIntent,
      testOptIn: process.env.NODE_ENV === "test" && process.env.ALLOW_DB_INTEGRATION_TESTS === "1",
    });
  } catch (error) {
    if (error instanceof GuardedTargetClassificationError) refuse(error.code, error.message);
    throw error;
  }

  for (const migration of options.requiredMigrations) {
    if (!target.appliedMigrations.includes(migration)) refuse("MIGRATION_REQUIRED", `Required migration is missing: ${migration}`);
  }
  if (options.requireMaintenance !== false && !target.maintenanceEnabled) refuse("MAINTENANCE_REQUIRED", "Maintenance mode must be enabled");
  if (!options.forExecution) return;
  if (!target.executeRequested) refuse("EXECUTE_FLAG_REQUIRED", "Explicit --execute is required");
  if (target.confirmDatabase !== target.database) refuse("DATABASE_CONFIRMATION_MISMATCH", "Database confirmation does not match");
}
