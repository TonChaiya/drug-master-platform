import type { Route } from "next";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  agentInstallations,
  agentSyncSessions,
  drugCatalogImports,
  drugMappings,
  facilities,
  sourceDrugs,
  standardProducts,
} from "@/db/schema";

export interface ReadinessItem {
  key: "jhcis" | "catalog" | "standards";
  label: string;
  ready: boolean;
  detail: string;
  href: Route;
  actionLabel: string;
}

export interface FacilityOverview {
  readiness: ReadinessItem[];
  sourceTotal: number;
  mappedTotal: number;
  pendingTotal: number;
  type01: number;
  type10: number;
  lastSyncAt: Date | null;
}

const bangkok = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "short",
  timeStyle: "short",
});

export function formatBangkok(value: Date | null | undefined): string {
  return value ? bangkok.format(value) : "—";
}

/** One round of small aggregate queries; everything is scoped by facilityId. */
export async function facilityOverview(facilityId: string): Promise<FacilityOverview> {
  const [drugCounts] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      type01: sql<number>`SUM(CASE WHEN ${sourceDrugs.drugtype} = '01' THEN 1 ELSE 0 END)`,
      type10: sql<number>`SUM(CASE WHEN ${sourceDrugs.drugtype} = '10' THEN 1 ELSE 0 END)`,
    })
    .from(sourceDrugs)
    .where(and(eq(sourceDrugs.facilityId, facilityId), eq(sourceDrugs.active, 1)));

  const [mappedCount] = await db
    .select({ total: count() })
    .from(drugMappings)
    .where(eq(drugMappings.facilityId, facilityId));

  const lastSync = await db
    .select({ finishedAt: agentSyncSessions.finishedAt })
    .from(agentSyncSessions)
    .where(and(eq(agentSyncSessions.facilityId, facilityId), eq(agentSyncSessions.status, "complete")))
    .orderBy(desc(agentSyncSessions.finishedAt))
    .limit(1);

  const installations = await db
    .select({ total: count() })
    .from(agentInstallations)
    .where(and(eq(agentInstallations.facilityId, facilityId), eq(agentInstallations.status, "active")));

  const latestImport = await db
    .select({ createdAt: drugCatalogImports.createdAt, rowCount: drugCatalogImports.rowCount })
    .from(drugCatalogImports)
    .where(eq(drugCatalogImports.facilityId, facilityId))
    .orderBy(desc(drugCatalogImports.createdAt))
    .limit(1);

  const [standardCount] = await db
    .select({
      tmt: sql<number>`SUM(CASE WHEN ${standardProducts.standardType} = 'TMT' AND ${standardProducts.status} = 'active' THEN 1 ELSE 0 END)`,
      ttmt: sql<number>`SUM(CASE WHEN ${standardProducts.standardType} = 'TTMT' AND ${standardProducts.status} = 'active' THEN 1 ELSE 0 END)`,
    })
    .from(standardProducts);

  const sourceTotal = Number(drugCounts?.total ?? 0);
  const mappedTotal = Number(mappedCount?.total ?? 0);
  const agentCount = Number(installations[0]?.total ?? 0);
  const tmtTotal = Number(standardCount?.tmt ?? 0);
  const ttmtTotal = Number(standardCount?.ttmt ?? 0);
  const lastSyncAt = lastSync[0]?.finishedAt ?? null;

  return {
    sourceTotal,
    mappedTotal,
    pendingTotal: Math.max(0, sourceTotal - mappedTotal),
    type01: Number(drugCounts?.type01 ?? 0),
    type10: Number(drugCounts?.type10 ?? 0),
    lastSyncAt,
    readiness: [
      {
        key: "jhcis",
        label: "JHCIS",
        ready: agentCount > 0 && sourceTotal > 0,
        detail:
          agentCount === 0
            ? "ยังไม่ได้ลงทะเบียน Agent"
            : sourceTotal === 0
              ? `Agent พร้อม ${agentCount} เครื่อง · ยังไม่ได้ดึงรายการยา`
              : `${sourceTotal.toLocaleString("th-TH")} รายการ · ดึงล่าสุด ${formatBangkok(lastSyncAt)}`,
        href: "/jhcis",
        actionLabel: agentCount === 0 ? "เชื่อมต่อ" : "ดึงข้อมูล",
      },
      {
        key: "catalog",
        label: "Drug Catalog",
        ready: latestImport.length > 0,
        detail: latestImport[0]
          ? `${latestImport[0].rowCount.toLocaleString("th-TH")} แถว · นำเข้า ${formatBangkok(latestImport[0].createdAt)}`
          : "ยังไม่มีไฟล์ล่าสุด",
        href: "/drug-catalog",
        actionLabel: "นำเข้า",
      },
      {
        key: "standards",
        label: "TMT / TTMT",
        ready: tmtTotal > 0 && ttmtTotal > 0,
        detail:
          tmtTotal === 0 && ttmtTotal === 0
            ? "ยังไม่ได้ sync มาตรฐาน"
            : `TMT ${tmtTotal.toLocaleString("th-TH")} · TTMT ${ttmtTotal.toLocaleString("th-TH")}`,
        href: "/standards",
        actionLabel: "ตั้งค่า",
      },
    ],
  };
}

export async function listActiveFacilities() {
  return db
    .select({ id: facilities.id, code: facilities.facilityCode, name: facilities.facilityName })
    .from(facilities)
    .where(eq(facilities.status, "active"))
    .orderBy(facilities.facilityCode);
}
