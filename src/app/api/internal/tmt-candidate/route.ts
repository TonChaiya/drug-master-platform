import { z } from "zod";
import { processTmtCandidateDelivery } from "@/modules/tmt/candidate-jobs";
import { candidateQueueCallback, candidateRuntime, dispatchTmtCandidate } from "@/modules/tmt/candidate-runtime";
import { tmtCandidateControlsEnabled } from "@/modules/tmt/feature";

export const runtime = "nodejs";
export const maxDuration = 300;

const payload = z.object({ id: z.string().uuid() }).strict();

// Deployed with a private Vercel queue trigger. The SDK retrieves the delivery
// from Vercel with project OIDC; it never takes a job from arbitrary JSON.
export const POST = candidateQueueCallback(async (message) => {
  const parsed = payload.safeParse(message);
  if (!parsed.success || !tmtCandidateControlsEnabled()) return;
  const { pool, source } = await candidateRuntime();
  await processTmtCandidateDelivery(pool, parsed.data.id, source, dispatchTmtCandidate);
}, {
  visibilityTimeoutSeconds: 300,
  retry: (_error, meta) => meta.deliveryCount >= 20
    ? { acknowledge: true }
    : { afterSeconds: Math.min(120, 15 * meta.deliveryCount) },
});
