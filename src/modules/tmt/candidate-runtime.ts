import { QueueClient } from "@vercel/queue";
import type { RowDataPacket } from "mysql2/promise";
import { dbPool } from "@/db/client";
import { classifyGuardedTarget, type GuardedTargetIdentity } from "@/modules/phase7/target-classification";
import { resolveTmtCredentialsFromPool } from "@/modules/standards/tmt-credentials";
import { tmtCandidateControlsEnabled } from "./feature";
import { createCredentialTmtSyncSource } from "./sync";

const queue = new QueueClient({ region: "sin1" });
export const candidateQueueCallback = queue.handleCallback;

export async function dispatchTmtCandidate(id: string, deliveryKey: string) {
  await queue.send("tmt-candidate", { id }, { idempotencyKey: deliveryKey, retentionSeconds: 86_400, delaySeconds: 2 });
}

export async function candidateRuntime() {
  if (!tmtCandidateControlsEnabled()) throw new Error("TMT_CANDIDATE_DISABLED");
  const target: GuardedTargetIdentity = {
    environment: "production", host: process.env.DB_HOST ?? "", port: Number(process.env.DB_PORT),
    database: process.env.DB_DATABASE ?? "", serverVersion: "TiDB",
    provider: "tidb-cloud", driver: "mysql2", tlsVerified: process.env.DB_SSL === "true",
    productionIntent: true, guardedOperation: "tmt-candidate", executeRequested: true,
  };
  classifyGuardedTarget(target);
  const pool = dbPool();
  const [rows] = await pool.query<RowDataPacket[]>("SELECT DATABASE() AS db,VERSION() AS version");
  classifyGuardedTarget({ ...target, database: String(rows[0]?.db ?? ""), serverVersion: String(rows[0]?.version ?? "") });
  const credentials = await resolveTmtCredentialsFromPool(pool);
  if (!credentials) throw new Error("TMT_CREDENTIALS_REQUIRED");
  return { pool, source: createCredentialTmtSyncSource(credentials) };
}
