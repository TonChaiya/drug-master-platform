import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import type { Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "@/db/schema";
import { appSettings, auditLogs } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";

export const MAINTENANCE_SETTING_KEY = "maintenance_mode";

const payloadSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).nullable(),
  changedBy: z.string().min(1),
  changedAt: z.iso.datetime(),
}).strict();

export interface StoredMaintenanceSetting {
  valueEncrypted: string;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface MaintenanceStore {
  read(): Promise<StoredMaintenanceSetting | null>;
  transition(input: { valueEncrypted: string; actorUserId: string; action: string; at: Date }): Promise<void>;
}

export interface MaintenanceState {
  available: boolean;
  enabled: boolean;
  reason: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

function createStore(database: typeof db): MaintenanceStore { return {
  async read() {
    const rows = await database.select({ valueEncrypted: appSettings.valueEncrypted, updatedBy: appSettings.updatedBy, updatedAt: appSettings.updatedAt })
      .from(appSettings).where(eq(appSettings.settingKey, MAINTENANCE_SETTING_KEY)).limit(1);
    return rows[0] ?? null;
  },
  async transition(input) {
    await database.transaction(async (tx) => {
      await tx.insert(appSettings).values({
        settingKey: MAINTENANCE_SETTING_KEY, valueEncrypted: input.valueEncrypted,
        updatedBy: input.actorUserId, updatedAt: input.at,
      }).onDuplicateKeyUpdate({ set: {
        valueEncrypted: sql`values(${appSettings.valueEncrypted})`,
        updatedBy: sql`values(${appSettings.updatedBy})`,
        updatedAt: sql`values(${appSettings.updatedAt})`,
      } });
      await tx.insert(auditLogs).values({
        id: randomUUID(), actorUserId: input.actorUserId, action: input.action,
        entityType: "app_setting", entityId: MAINTENANCE_SETTING_KEY,
        afterJson: { enabled: input.action === "maintenance.enabled" }, createdAt: input.at,
      });
    });
  },
}; }

const defaultStore = createStore(db);

export function maintenanceStoreForPool(pool: Pool): MaintenanceStore {
  return createStore(drizzle(pool, { schema, mode: "default" }) as typeof db);
}

export async function readMaintenanceState(store: MaintenanceStore = defaultStore): Promise<MaintenanceState> {
  const row = await store.read();
  if (!row) return { available: true, enabled: false, reason: null, changedBy: null, changedAt: null };
  try {
    const payload = payloadSchema.parse(JSON.parse(decryptSecret(row.valueEncrypted)));
    return { available: true, enabled: payload.enabled, reason: payload.reason, changedBy: payload.changedBy, changedAt: payload.changedAt };
  } catch {
    console.error("maintenance.state_unavailable");
    return { available: false, enabled: true, reason: null, changedBy: row.updatedBy, changedAt: row.updatedAt.toISOString() };
  }
}

export async function setMaintenanceMode(
  input: { enabled: boolean; reason: string | null; actorUserId: string; now?: Date },
  store: MaintenanceStore = defaultStore,
): Promise<{ changed: boolean; state: MaintenanceState }> {
  const current = await readMaintenanceState(store);
  if (current.available && current.enabled === input.enabled) return { changed: false, state: current };
  const at = input.now ?? new Date();
  const payload = payloadSchema.parse({ enabled: input.enabled, reason: input.reason?.trim() || null, changedBy: input.actorUserId, changedAt: at.toISOString() });
  await store.transition({
    valueEncrypted: encryptSecret(JSON.stringify(payload)), actorUserId: input.actorUserId,
    action: input.enabled ? "maintenance.enabled" : "maintenance.disabled", at,
  });
  return { changed: true, state: { available: true, ...payload } };
}
