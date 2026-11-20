export type GuardedTargetClass = "LOCAL_CLONE_REHEARSAL" | "TEST" | "PRODUCTION";

export interface GuardedTargetIdentity {
  environment: "local" | "production";
  host: string;
  port: number;
  database: string;
  serverVersion: string;
  rehearsalIntent?: boolean;
  testOptIn?: boolean;
}

export class GuardedTargetClassificationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GuardedTargetClassificationError";
  }
}

function refuse(code: string, message: string): never {
  throw new GuardedTargetClassificationError(code, message);
}

function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function classifyGuardedTarget(target: GuardedTargetIdentity): GuardedTargetClass {
  if (target.port === 3333) refuse("PORT_FORBIDDEN", "Port 3333 is never an allowed target");
  if (target.database.toLowerCase() === "jhcisdb") refuse("DATABASE_FORBIDDEN", "jhcisdb is never an allowed target");

  if (target.environment === "production") {
    if (target.rehearsalIntent) refuse("REHEARSAL_ENVIRONMENT_INVALID", "Local rehearsal intent cannot authorize Production");
    if (!target.host.toLowerCase().endsWith(".tidbcloud.com")) refuse("PRODUCTION_HOST_INVALID", "Production host is not TiDB Cloud");
    if (target.port !== 4000) refuse("PRODUCTION_PORT_INVALID", "Production port must be 4000");
    if (target.database !== "drug_master_platform") refuse("PRODUCTION_DATABASE_INVALID", "Production database identity mismatch");
    if (!/tidb/i.test(target.serverVersion)) refuse("PRODUCTION_ENGINE_INVALID", "Production server is not TiDB");
    return "PRODUCTION";
  }

  if (!isLocalHost(target.host)) refuse("LOCAL_HOST_INVALID", "Local operation must use a strict localhost target");
  if (target.port !== 3306) refuse("LOCAL_PORT_INVALID", "Local operation must use port 3306");

  if (target.database === "drug_master_platform") {
    if (!target.rehearsalIntent) refuse("REHEARSAL_INTENT_REQUIRED", "The local Production clone requires explicit rehearsal intent");
    if (!/^8\.4\.3(?:\D|$)/.test(target.serverVersion)) refuse("LOCAL_ENGINE_INVALID", "Local rehearsal requires MySQL 8.4.3");
    return "LOCAL_CLONE_REHEARSAL";
  }

  if (/^drug_master_[a-z0-9_]*test$/.test(target.database)) {
    if (!target.testOptIn) refuse("LOCAL_TEST_OPT_IN_REQUIRED", "Test targets require the explicit integration-test opt-in");
    return "TEST";
  }

  return refuse("LOCAL_DATABASE_INVALID", "Unknown local database target");
}
