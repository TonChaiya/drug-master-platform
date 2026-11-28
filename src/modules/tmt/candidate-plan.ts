import { z } from "zod";
import { TMT_CORE_ENDPOINTS, TMT_OPTIONAL_ENDPOINTS } from "./sync";
import type { TmtDataEndpoint } from "./persistence";
import { bangkokDate, incrementalWindow, partitionHistoricalWindows, TMT_HISTORY_START, type TmtDateWindow } from "./windows";

const endpoints = [...TMT_CORE_ENDPOINTS, ...TMT_OPTIONAL_ENDPOINTS];
const dateShape = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const candidateRequestSchema = z.object({
  mode: z.enum(["full", "incremental"]),
  begin: dateShape.optional(),
  end: dateShape.optional(),
}).strict();

const checkpointSchema = z.object({
  endpoint: z.custom<TmtDataEndpoint>((value) => typeof value === "string" && endpoints.some((endpoint) => endpoint === value)),
  window: z.object({ begindate: dateShape, enddate: dateShape }),
});
export const candidatePlanSchema = z.array(checkpointSchema).min(1).max(1500);
export type CandidateCheckpoint = z.infer<typeof checkpointSchema>;
export type CandidateRequest = z.infer<typeof candidateRequestSchema>;

export function buildCandidatePlan(request: CandidateRequest, now: Date, baseThrough?: string): CandidateCheckpoint[] {
  const today = bangkokDate(now);
  const end = request.end ?? today;
  if (end !== today) throw new Error("TMT_COVERAGE_MUST_END_TODAY");
  if (request.mode === "incremental" && !baseThrough) throw new Error("TMT_BASE_COVERAGE_REQUIRED");
  const requiredBegin = request.mode === "full"
    ? TMT_HISTORY_START
    : incrementalWindow(baseThrough!, end).begindate;
  const begin = request.begin ?? requiredBegin;
  if (begin < TMT_HISTORY_START || begin > requiredBegin) throw new Error("TMT_COVERAGE_GAP");
  const windows = partitionHistoricalWindows(begin, end);
  return candidatePlanSchema.parse(endpoints.flatMap((endpoint) => windows.map((window: TmtDateWindow) => ({ endpoint, window }))));
}

export function isPinnedTmtVersion(version: string): boolean {
  return version === version.trim() && version.length > 0 && version.length <= 32 && !/^unverified:/i.test(version);
}
