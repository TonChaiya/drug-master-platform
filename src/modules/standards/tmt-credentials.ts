import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";

const SETTING_KEY = "tmt_api";
export const DEFAULT_TMT_API_BASE = "https://tmt.this.or.th/tmtapi";

export interface TmtCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

/** What an admin may see: never the password, only whether one is stored. */
export interface TmtCredentialStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  baseUrl: string;
  username: string;
  updatedAt: string | null;
}

function normalizeBase(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return trimmed || DEFAULT_TMT_API_BASE;
}

function fromEnvironment(): TmtCredentials | null {
  const username = process.env.TMT_API_USER?.trim();
  const password = process.env.TMT_API_PASSWORD;
  if (!username || !password) return null;
  return { baseUrl: normalizeBase(process.env.TMT_API_BASE), username, password };
}

async function fromDatabase(): Promise<{ credentials: TmtCredentials; updatedAt: Date } | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.settingKey, SETTING_KEY)).limit(1);
  const row = rows[0];
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptSecret(row.valueEncrypted));
  } catch {
    // A blob that will not decrypt means APP_ENCRYPTION_KEY was rotated without
    // re-saving. Fall through to the environment rather than failing every sync.
    return null;
  }
  const value = parsed as Partial<TmtCredentials>;
  if (!value.username || !value.password) return null;
  return {
    credentials: { baseUrl: normalizeBase(value.baseUrl), username: value.username, password: value.password },
    updatedAt: row.updatedAt,
  };
}

/** Database first, environment as the fallback for deployments that predate this screen. */
export async function resolveTmtCredentials(): Promise<TmtCredentials | null> {
  const stored = await fromDatabase();
  return stored?.credentials ?? fromEnvironment();
}

export async function readTmtCredentialStatus(): Promise<TmtCredentialStatus> {
  const stored = await fromDatabase();
  if (stored) {
    return {
      configured: true,
      source: "database",
      baseUrl: stored.credentials.baseUrl,
      username: stored.credentials.username,
      updatedAt: stored.updatedAt.toISOString(),
    };
  }
  const environment = fromEnvironment();
  if (environment) {
    return { configured: true, source: "environment", baseUrl: environment.baseUrl, username: environment.username, updatedAt: null };
  }
  return { configured: false, source: "none", baseUrl: normalizeBase(process.env.TMT_API_BASE), username: "", updatedAt: null };
}

export async function saveTmtCredentials(input: TmtCredentials, actorUserId: string): Promise<void> {
  const value = encryptSecret(
    JSON.stringify({ baseUrl: normalizeBase(input.baseUrl), username: input.username.trim(), password: input.password }),
  );
  await db
    .insert(appSettings)
    .values({ settingKey: SETTING_KEY, valueEncrypted: value, updatedBy: actorUserId, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { valueEncrypted: value, updatedBy: actorUserId, updatedAt: new Date() } });
}

export async function clearTmtCredentials(): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.settingKey, SETTING_KEY));
}
