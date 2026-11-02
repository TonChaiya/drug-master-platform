import { lt } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { rateLimitBuckets } from "@/db/schema";

const RETENTION_GRACE_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1_000;
const MAX_BATCHES = 10;

type RateLimitDatabase = MySql2Database<typeof schema>;
type DeleteBatch = (cutoff: Date, batchSize: number) => Promise<number>;

export async function deleteExpiredRateLimitBucketBatch(
  database: RateLimitDatabase,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  const [result] = await database
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.expiresAt, cutoff))
    .orderBy(rateLimitBuckets.expiresAt)
    .limit(batchSize);
  return result.affectedRows;
}

const deleteDefault: DeleteBatch = (cutoff, batchSize) => deleteExpiredRateLimitBucketBatch(db, cutoff, batchSize);

export async function cleanupExpiredRateLimitBuckets(
  options: { now?: Date; deleteBatch?: DeleteBatch } = {},
): Promise<{ deleted: number; batches: number }> {
  const cutoff = new Date((options.now ?? new Date()).getTime() - RETENTION_GRACE_MS);
  const deleteBatch = options.deleteBatch ?? deleteDefault;
  let deleted = 0;
  let batches = 0;

  // ponytail: Bound one invocation to 10,000 rows; the next daily run
  // continues any backlog without holding a long transaction or function.
  while (batches < MAX_BATCHES) {
    const batchDeleted = await deleteBatch(cutoff, BATCH_SIZE);
    if (batchDeleted === 0) break;
    deleted += batchDeleted;
    batches += 1;
    if (batchDeleted < BATCH_SIZE) break;
  }

  return { deleted, batches };
}
