import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  GUARDED_PRODUCTION_OPERATIONS,
  type GuardedProductionOperation,
} from "./target-classification";

export const APPROVED_TTMT_WORKBOOK_SHA256 = "88618ebf566ed5680f7ad49c00e55ad920e6699c1324b707ea5375a440dca057";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const timestamp = z.string().datetime({ offset: true });
const operation = z.enum(GUARDED_PRODUCTION_OPERATIONS);

export const productionReadinessSchema = z.object({
  provider: z.literal("tidb-cloud"),
  database: z.literal("drug_master_platform"),
  storage: z.object({
    observationTimestamp: timestamp,
    currentUsageBytes: z.number().int().nonnegative(),
    quotaBytes: z.number().int().positive().nullable(),
    availableBytes: z.number().int().nonnegative().nullable(),
    headroomEvidence: z.string().min(1),
    adequateForOperations: z.array(operation).min(1),
    operatorConfirmedAdequate: z.literal(true),
  }).strict().refine((value) => value.quotaBytes !== null || value.availableBytes !== null, {
    message: "Storage quota or available-headroom evidence is required",
  }),
  backup: z.object({
    exportId: z.string().min(1),
    manifestSha256: sha256,
    recoveryRehearsal: z.literal("PASS"),
    rehearsedAt: timestamp,
  }).strict(),
  workbook: z.object({
    sha256: z.literal(APPROVED_TTMT_WORKBOOK_SHA256),
    rowCount: z.literal(9_654),
    verifiedAt: timestamp,
  }).strict(),
  probe: z.object({
    operationId: z.string().uuid(),
    result: z.literal("PASS"),
    completedAt: timestamp,
    cleanup: z.literal("PASS"),
  }).strict().optional(),
  maintenance: z.object({
    windowId: z.string().min(1),
    approved: z.literal(true),
    active: z.literal(true),
    operatorId: z.string().uuid(),
    approvedAt: timestamp,
    approvedOperations: z.array(operation).min(1),
  }).strict(),
}).strict();

export type ProductionReadinessEvidence = z.infer<typeof productionReadinessSchema>;

export class ProductionReadinessError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProductionReadinessError";
  }
}

function refuse(code: string, message: string): never {
  throw new ProductionReadinessError(code, message);
}

export function assertExternalOperatorFile(path: string | undefined, repositoryRoot: string, label: string): string {
  if (!path?.trim()) refuse("OPERATOR_FILE_REQUIRED", `Explicit external ${label} file is required`);
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(repositoryRoot);
  const pathFromRoot = relative(resolvedRoot, resolvedPath);
  const insideRepository = pathFromRoot === ""
    || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
  if (insideRepository || basename(resolvedPath).toLowerCase() === ".env.local") {
    refuse("OPERATOR_FILE_UNSAFE", `${label} file must be outside the repository and must not be .env.local`);
  }
  if (!existsSync(resolvedPath)) refuse("OPERATOR_FILE_MISSING", `${label} file does not exist`);
  return resolvedPath;
}

export function loadProductionReadinessFile(path: string | undefined, repositoryRoot: string): ProductionReadinessEvidence {
  const external = assertExternalOperatorFile(path, repositoryRoot, "readiness evidence");
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(external, "utf8"));
  } catch {
    refuse("READINESS_FILE_INVALID", "Readiness evidence is not valid JSON");
  }
  const parsed = productionReadinessSchema.safeParse(input);
  if (!parsed.success) refuse("READINESS_EVIDENCE_INVALID", "Readiness evidence does not match the guarded contract");
  return parsed.data;
}

export function assertProductionReadiness(
  evidence: ProductionReadinessEvidence,
  guardedOperation: GuardedProductionOperation,
  options: { requireProbe: boolean },
): void {
  if (!evidence.storage.adequateForOperations.includes(guardedOperation)) {
    refuse("STORAGE_EVIDENCE_MISSING", "Storage evidence does not approve this operation");
  }
  if (!evidence.maintenance.approvedOperations.includes(guardedOperation)) {
    refuse("MAINTENANCE_OPERATION_NOT_APPROVED", "Maintenance approval does not include this operation");
  }
  if (options.requireProbe && (!evidence.probe || evidence.probe.result !== "PASS" || evidence.probe.cleanup !== "PASS")) {
    refuse("TIDB_PROBE_REQUIRED", "A successful ownership-cleaned TiDB probe is required");
  }
}

export function redactOperatorMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/(password|token|secret|database_url)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/mysql:\/\/[^\s]+/gi, "mysql://[REDACTED]");
}
