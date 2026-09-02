import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";

const SETTING_KEY = "agent_installer";

export interface InstallerLink {
  url: string;
  version: string;
  updatedAt: string | null;
  source: "database" | "environment" | "none";
}

const DRIVE_FILE = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/;
const DRIVE_OPEN = /^https:\/\/drive\.google\.com\/open\?id=([A-Za-z0-9_-]+)/;

/**
 * A Google Drive "share" link opens a preview page, not a download. Rewriting it
 * to the uc?export=download form is what makes the button on the JHCIS page
 * actually hand over a file.
 *
 * Drive still shows a virus-scan interstitial for anything over ~25 MB, and the
 * installer is larger than that, so the admin screen says so rather than
 * pretending the rewrite makes it a clean direct download.
 */
export function normalizeInstallerUrl(input: string): string {
  const url = input.trim();
  const fileMatch = DRIVE_FILE.exec(url) ?? DRIVE_OPEN.exec(url);
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  return url;
}

export function isDriveLink(url: string): boolean {
  return url.startsWith("https://drive.google.com/");
}

async function fromDatabase(): Promise<{ url: string; version: string; updatedAt: Date } | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.settingKey, SETTING_KEY)).limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    const value = JSON.parse(decryptSecret(row.valueEncrypted)) as { url?: string; version?: string };
    if (!value.url) return null;
    return { url: value.url, version: value.version ?? "", updatedAt: row.updatedAt };
  } catch {
    return null;
  }
}

/** Database first; the build-time env var stays as the fallback. */
export async function readInstallerLink(): Promise<InstallerLink> {
  const stored = await fromDatabase();
  if (stored) return { url: stored.url, version: stored.version, updatedAt: stored.updatedAt.toISOString(), source: "database" };

  const fromEnvironment = process.env.NEXT_PUBLIC_AGENT_INSTALLER_URL?.trim();
  if (fromEnvironment) return { url: fromEnvironment, version: "", updatedAt: null, source: "environment" };

  return { url: "", version: "", updatedAt: null, source: "none" };
}

export async function saveInstallerLink(input: { url: string; version: string }, actorUserId: string): Promise<void> {
  const value = encryptSecret(JSON.stringify({ url: normalizeInstallerUrl(input.url), version: input.version.trim() }));
  await db
    .insert(appSettings)
    .values({ settingKey: SETTING_KEY, valueEncrypted: value, updatedBy: actorUserId, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { valueEncrypted: value, updatedBy: actorUserId, updatedAt: new Date() } });
}

export async function clearInstallerLink(): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.settingKey, SETTING_KEY));
}
