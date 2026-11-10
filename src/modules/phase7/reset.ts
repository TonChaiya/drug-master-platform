import type { Pool } from "mysql2/promise";
import { tableCounts } from "./database";

export const RESET_TABLES = [
  "export_preview_tokens", "mapping_export_checkpoints", "mapping_review_acknowledgements", "drug_mappings",
  "drug_catalog_rows", "drug_catalog_imports", "agent_sync_staging", "source_drugs", "agent_sync_sessions",
  "standard_products", "standard_imports", "standard_sync_runs",
  "tmt_sync_checkpoints", "tmt_version", "tmt_relationship", "tmt_concept", "tmt_mastertmt", "tmt_regno",
  "tmt_atc", "tmt_nlem", "tmt_tpp", "tmt_tpu", "tmt_tp", "tmt_gpp", "tmt_gpu", "tmt_gp", "tmt_vtm", "tmt_subs",
  "tmt_sync_runs", "ttmt_products", "ttmt_imports",
] as const;

export const TMT_V2_RESET_TABLES = [
  "tmt_sync_checkpoints", "tmt_version", "tmt_relationship", "tmt_concept", "tmt_mastertmt", "tmt_regno",
  "tmt_atc", "tmt_nlem", "tmt_tpp", "tmt_tpu", "tmt_tp", "tmt_gpp", "tmt_gpu", "tmt_gp", "tmt_vtm", "tmt_subs",
  "tmt_sync_runs",
] as const;

export type ResetMode = "full" | "tmt-v2-only";

export const KEEP_TABLES = [
  "users", "facilities", "sessions", "app_settings", "audit_logs", "agent_installations", "agent_credentials",
  "agent_request_nonces", "agent_commands", "agent_enrollment_tokens", "rate_limit_buckets", "schema_migrations",
] as const;

const resetSet = new Set<string>(RESET_TABLES);
const tmtV2ResetSet = new Set<string>(TMT_V2_RESET_TABLES);
const keepSet = new Set<string>(KEEP_TABLES);

export function resetTablesForMode(mode: ResetMode): readonly string[] {
  return mode === "tmt-v2-only" ? TMT_V2_RESET_TABLES : RESET_TABLES;
}

export function preservedTablesForMode(mode: ResetMode): readonly string[] {
  return mode === "tmt-v2-only"
    ? [...KEEP_TABLES, ...RESET_TABLES.filter((table) => !tmtV2ResetSet.has(table))]
    : KEEP_TABLES;
}

export function assertResetTable(table: string, mode: ResetMode): void {
  if (keepSet.has(table)) throw new Error(`KEEP table is hard-denied: ${table}`);
  const allowed = mode === "tmt-v2-only" ? tmtV2ResetSet : resetSet;
  if (!allowed.has(table)) throw new Error(`Table is not in the ${mode} reset allowlist and is hard-denied: ${table}`);
}

export interface ResetStore {
  counts(): Promise<Record<string, number>>;
  execute(): Promise<void>;
}

export function mysqlResetStore(pool: Pool, mode: ResetMode): ResetStore {
  const tables = resetTablesForMode(mode);
  return {
    counts: () => tableCounts(pool, tables),
    async execute() {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const table of tables) {
          assertResetTable(table, mode);
          await connection.query(`DELETE FROM \`${table}\``);
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

export async function runPhase7Reset(
  input: { mode: ResetMode; execute: boolean; backupReference: string },
  store: ResetStore,
): Promise<{ mode: ResetMode; executed: boolean; before: Record<string, number>; after: Record<string, number> | null }> {
  if (!input.backupReference.trim()) throw new Error("A verified backup reference is required");
  const before = await store.counts();
  if (!input.execute) return { mode: input.mode, executed: false, before, after: null };
  await store.execute();
  return { mode: input.mode, executed: true, before, after: await store.counts() };
}
