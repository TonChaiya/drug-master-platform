import { z } from "zod";
import { isValidOfficeId } from "@/lib/validation/facility";

const officeId = z.string().refine(isValidOfficeId, "officeId ต้องเป็นเลข 5 หลักและไม่ใช่ 0000x");
const agentVersion = z.string().trim().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/).max(32);
const money = z.union([z.number(), z.string()]).nullable().optional();

export const enrollRequestSchema = z
  .object({
    enrollmentToken: z.string().trim().min(32).max(128),
    installationId: z.uuid(),
    machineLabel: z.string().trim().min(1).max(128),
    officeId,
    agentVersion,
  })
  .strict();

export const pollRequestSchema = z
  .object({
    installationId: z.uuid(),
    agentVersion,
    officeId,
  })
  .strict();

export const completeRequestSchema = z
  .object({
    installationId: z.uuid(),
    claimToken: z.uuid(),
    success: z.boolean(),
    resultCode: z.string().trim().max(48).optional(),
    resultMessage: z.string().trim().max(500).optional(),
  })
  .strict();

export const syncBeginSchema = z
  .object({
    installationId: z.uuid(),
    officeId,
    expectedRows: z.number().int().min(0).max(200_000),
    agentVersion,
  })
  .strict();

/** One JHCIS cdrug row. Field list is fixed by docs/OPERATIONS.md. */
export const sourceRowSchema = z
  .object({
    drugcode: z.string().trim().min(1).max(64),
    drugname: z.string().trim().max(255).nullable().optional(),
    drugnamethai: z.string().trim().max(255).nullable().optional(),
    druggenericname: z.string().trim().max(255).nullable().optional(),
    drugtype: z.enum(["01", "10"]),
    pack: z.string().trim().max(120).nullable().optional(),
    unitsell: z.string().trim().max(120).nullable().optional(),
    unitusage: z.string().trim().max(120).nullable().optional(),
    cost: money,
    sell: money,
    nationaccount: z.string().trim().max(32).nullable().optional(),
    drugcode24: z.string().trim().max(32).nullable().optional(),
  })
  .strict();

export const syncBatchSchema = z
  .object({
    installationId: z.uuid(),
    sessionId: z.uuid(),
    officeId,
    rows: z.array(sourceRowSchema).min(1).max(500),
  })
  .strict();

export const syncFinishSchema = z
  .object({
    installationId: z.uuid(),
    sessionId: z.uuid(),
    officeId,
  })
  .strict();

export type EnrollRequest = z.infer<typeof enrollRequestSchema>;
export type SourceRow = z.infer<typeof sourceRowSchema>;
export type SyncBatchRequest = z.infer<typeof syncBatchSchema>;
