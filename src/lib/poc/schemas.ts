import { z } from "zod";
import { isValidOfficeId } from "@/lib/poc/facility";

export const agentReportSchema = z
  .object({
    installationId: z.uuid(),
    machineName: z.string().trim().min(1).max(128),
    agentVersion: z.string().trim().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/).max(32),
    officeId: z.string().refine(isValidOfficeId, "officeId ต้องเป็นเลข 5 หลักและไม่ใช่ 0000x"),
    jhcisConnected: z.boolean(),
    eligibleDrugCount: z.number().int().min(0).max(1_000_000),
    checkedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AgentReport = z.infer<typeof agentReportSchema>;
