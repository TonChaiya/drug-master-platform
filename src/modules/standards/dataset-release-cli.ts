import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";
import { assertOperationalTarget, type OperationalEnvironment, type OperationalTarget } from "@/modules/phase7/guards";

const COMMANDS = ["preflight", "status", "baseline", "resume", "validate", "approve", "publish", "rollback", "verify"] as const;
const MUTATIONS = new Set<string>(["baseline", "resume", "validate", "approve", "publish", "rollback"]);
const MIGRATION_0018 = "0018_versioned_standard_dataset_foundation.sql";
const uuid = z.string().uuid();

export type DatasetReleaseCliCommand = typeof COMMANDS[number];

export interface DatasetReleaseCliRequest {
  command: DatasetReleaseCliCommand;
  environment: OperationalEnvironment;
  envFile: string;
  execute: boolean;
  confirmDatabase?: string;
  confirmAction?: string;
  actorUserId?: string;
  reason?: string;
  datasetId?: string;
  source?: "TMT" | "TTMT";
  sourceVersion?: string;
  tmtSyncRunId?: string;
  ttmtImportId?: string;
  batchSize?: number;
  releaseId?: string;
  tmtDatasetId?: string;
  ttmtDatasetId?: string;
  expectedActiveReleaseId?: string | null;
}

export interface DatasetReleaseCliResult {
  command: DatasetReleaseCliCommand;
  environment: OperationalEnvironment;
  database: string;
  executed: boolean;
  result: unknown;
}

export interface DatasetReleaseCliDependencies {
  inspectTarget(request: DatasetReleaseCliRequest): Promise<OperationalTarget>;
  readActiveReleaseId(target: OperationalTarget): Promise<string | null>;
  read(request: DatasetReleaseCliRequest, target: OperationalTarget): Promise<unknown>;
  mutate(request: DatasetReleaseCliRequest, target: OperationalTarget): Promise<unknown>;
}

export class DatasetReleaseCliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DatasetReleaseCliError";
  }
}

function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new DatasetReleaseCliError("OPTION_REQUIRED", `${option} is required`);
  return value.trim();
}

function parseUuid(value: string | undefined, option: string): string {
  return uuid.parse(required(value, option));
}

function mutationTarget(request: DatasetReleaseCliRequest): string {
  const target = request.command === "baseline" || request.command === "resume"
    ? request.datasetId
    : request.releaseId;
  return required(target, request.command === "baseline" || request.command === "resume" ? "--dataset-id" : "--release-id");
}

export function datasetReleaseReasonSha256(reason: string): string {
  return createHash("sha256").update(reason).digest("hex");
}

export function parseDatasetReleaseCli(argv: string[]): DatasetReleaseCliRequest {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      environment: { type: "string" }, "env-file": { type: "string" }, execute: { type: "boolean" }, "dry-run": { type: "boolean" },
      "confirm-db": { type: "string" }, "confirm-action": { type: "string" }, "actor-user-id": { type: "string" }, reason: { type: "string" },
      "dataset-id": { type: "string" }, source: { type: "string" }, "source-version": { type: "string" },
      "tmt-sync-run-id": { type: "string" }, "ttmt-import-id": { type: "string" }, "batch-size": { type: "string" },
      "release-id": { type: "string" }, "tmt-dataset-id": { type: "string" }, "ttmt-dataset-id": { type: "string" },
      "expected-active-release-id": { type: "string" },
    },
  });
  if (parsed.positionals.length !== 1) throw new DatasetReleaseCliError("COMMAND_REQUIRED", "Exactly one dataset release command is required");
  const commandResult = z.enum(COMMANDS).safeParse(parsed.positionals[0]);
  if (!commandResult.success) throw new DatasetReleaseCliError("COMMAND_INVALID", "Dataset release command is invalid");
  const command = commandResult.data;
  const environmentResult = z.enum(["local", "production"]).safeParse(parsed.values.environment);
  if (!environmentResult.success) throw new DatasetReleaseCliError("ENVIRONMENT_INVALID", "Environment must be local or production");
  const environment = environmentResult.data;
  const envFile = required(parsed.values["env-file"], "--env-file");
  const execute = parsed.values.execute === true;
  if (execute && parsed.values["dry-run"] === true) throw new DatasetReleaseCliError("EXECUTION_MODE_CONFLICT", "Choose --dry-run or --execute, not both");

  const request: DatasetReleaseCliRequest = {
    command, environment, envFile, execute,
    confirmDatabase: parsed.values["confirm-db"], confirmAction: parsed.values["confirm-action"],
  };
  if (!MUTATIONS.has(command)) {
    if (execute) throw new DatasetReleaseCliError("READ_ONLY_COMMAND", `${command} is read-only and does not accept --execute`);
    if (parsed.values["release-id"]) request.releaseId = parseUuid(parsed.values["release-id"], "--release-id");
    if (parsed.values["dataset-id"]) request.datasetId = parseUuid(parsed.values["dataset-id"], "--dataset-id");
    return request;
  }

  request.actorUserId = parseUuid(parsed.values["actor-user-id"], "--actor-user-id");
  request.reason = required(parsed.values.reason, "--reason");
  if (command === "baseline" || command === "resume") {
    request.datasetId = parseUuid(parsed.values["dataset-id"], "--dataset-id");
    request.source = z.enum(["TMT", "TTMT"]).parse(parsed.values.source);
    request.sourceVersion = required(parsed.values["source-version"], "--source-version");
    request.batchSize = z.coerce.number().int().min(1).max(5_000).default(500).parse(parsed.values["batch-size"]);
    if (request.source === "TMT") {
      if (parsed.values["ttmt-import-id"]) throw new DatasetReleaseCliError("SOURCE_LINKAGE_AMBIGUOUS", "Ambiguous source linkage: TMT baseline accepts only a TMT source run");
      request.tmtSyncRunId = parseUuid(parsed.values["tmt-sync-run-id"], "--tmt-sync-run-id");
    } else {
      if (parsed.values["tmt-sync-run-id"]) throw new DatasetReleaseCliError("SOURCE_LINKAGE_AMBIGUOUS", "Ambiguous source linkage: TTMT baseline accepts only a TTMT import");
      request.ttmtImportId = parseUuid(parsed.values["ttmt-import-id"], "--ttmt-import-id");
    }
  } else {
    request.releaseId = parseUuid(parsed.values["release-id"], "--release-id");
  }
  if (command === "validate") {
    request.tmtDatasetId = parseUuid(parsed.values["tmt-dataset-id"], "--tmt-dataset-id");
    request.ttmtDatasetId = parseUuid(parsed.values["ttmt-dataset-id"], "--ttmt-dataset-id");
  }
  const expected = required(parsed.values["expected-active-release-id"], "--expected-active-release-id");
  request.expectedActiveReleaseId = expected === "none" ? null : uuid.parse(expected);
  if (execute) {
    required(request.confirmDatabase, "--confirm-db");
    required(request.confirmAction, "--confirm-action");
  }
  return request;
}

export async function runDatasetReleaseCli(
  request: DatasetReleaseCliRequest,
  dependencies: DatasetReleaseCliDependencies,
): Promise<DatasetReleaseCliResult> {
  const target = await dependencies.inspectTarget(request);
  assertOperationalTarget(target, {
    forExecution: request.execute,
    requiredMigrations: request.command === "preflight" ? [] : [MIGRATION_0018],
    requireMaintenance: request.execute,
  });
  if (!MUTATIONS.has(request.command)) {
    return { command: request.command, environment: request.environment, database: target.database, executed: false, result: await dependencies.read(request, target) };
  }
  const activeReleaseId = await dependencies.readActiveReleaseId(target);
  if (activeReleaseId !== request.expectedActiveReleaseId) {
    throw new DatasetReleaseCliError("ACTIVE_RELEASE_CHANGED", "Active standard release differs from the explicit expectation");
  }
  if (!request.execute) {
    return {
      command: request.command, environment: request.environment, database: target.database, executed: false,
      result: {
        dryRun: true, targetId: mutationTarget(request), activeReleaseId, actorUserId: request.actorUserId,
        reasonSha256: datasetReleaseReasonSha256(request.reason!),
      },
    };
  }
  const expectedConfirmation = `EXECUTE ${request.command} ${mutationTarget(request)}`;
  if (request.confirmAction !== expectedConfirmation) {
    throw new DatasetReleaseCliError("ACTION_CONFIRMATION_MISMATCH", `Action confirmation must equal: ${expectedConfirmation}`);
  }
  return {
    command: request.command, environment: request.environment, database: target.database, executed: true,
    result: await dependencies.mutate(request, target),
  };
}

function sensitiveKey(key: string): boolean {
  return /password|secret|token|credential|authorization/i.test(key);
}

export function redactDatasetReleaseCliValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDatasetReleaseCliValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKey(key) ? "[REDACTED]" : redactDatasetReleaseCliValue(item),
  ]));
}
