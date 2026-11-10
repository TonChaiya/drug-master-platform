import type { Route } from "next";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  agentSyncSessions,
  drugCatalogImports,
  facilities,
  ttmtImports,
  ttmtProducts,
} from "@/db/schema";
import { agentFacilitySummaries } from "@/modules/agent/queries";
import { emptyMappingLifecycleSummary, mappingLifecycleSummaries } from "@/modules/mappings/summary";
import { readTmtV2Readiness } from "@/modules/tmt/readiness";

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
  needsReviewTotal: number;
  exportReadyTotal: number;
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
  /*
   * Independent reads are issued together.
   *
   * Awaiting them one after another spent six round trips where one would do,
   * and a round trip is the whole cost here: the queries themselves take a few
   * milliseconds, the trip to TiDB takes tens — hundreds if the function is not
   * in the same region as the database.
   */
  const [mappingSummaries, agentSummaries, lastSync, latestImport, tmtReadiness, latestTtmtImport, ttmtCountRows] = await Promise.all([
    mappingLifecycleSummaries(facilityId),
    agentFacilitySummaries(facilityId),
    db
      .select({ finishedAt: agentSyncSessions.finishedAt })
      .from(agentSyncSessions)
      .where(and(eq(agentSyncSessions.facilityId, facilityId), eq(agentSyncSessions.status, "complete")))
      .orderBy(desc(agentSyncSessions.finishedAt))
      .limit(1),

    db
      .select({ createdAt: drugCatalogImports.createdAt, rowCount: drugCatalogImports.rowCount })
      .from(drugCatalogImports)
      .where(eq(drugCatalogImports.facilityId, facilityId))
      .orderBy(desc(drugCatalogImports.createdAt))
      .limit(1),

    readTmtV2Readiness(),
    db
      .select({ version: ttmtImports.version, rowCount: ttmtImports.rowCount })
      .from(ttmtImports)
      .where(eq(ttmtImports.status, "succeeded"))
      .orderBy(desc(ttmtImports.completedAt))
      .limit(1),
    db.select({ total: count() }).from(ttmtProducts),
  ]);

  const mappingSummary = mappingSummaries.get(facilityId) ?? emptyMappingLifecycleSummary(facilityId);
  const agentSummary = agentSummaries.get(facilityId);

  const sourceTotal = mappingSummary.sourceTotal;
  const mappedTotal = mappingSummary.mappedTotal;
  const agentCount = agentSummary?.agentCount ?? 0;
  const installationCount = agentSummary?.installationCount ?? 0;
  const ttmtTotal = Number(ttmtCountRows[0]?.total ?? 0);
  const lastSyncAt = lastSync[0]?.finishedAt ?? null;

  return {
    sourceTotal,
    mappedTotal,
    pendingTotal: mappingSummary.pendingTotal,
    needsReviewTotal: mappingSummary.needsReviewTotal,
    exportReadyTotal: mappingSummary.exportReadyTotal,
    type01: mappingSummary.type01,
    type10: mappingSummary.type10,
    lastSyncAt,
    readiness: [
      {
        key: "jhcis",
        label: "JHCIS",
        ready:
          (agentSummary?.usableAgentCount ?? 0) > 0 &&
          (agentSummary?.onlineAgentCount ?? 0) > 0 &&
          (agentSummary?.jhcisConnectedCount ?? 0) > 0 &&
          (agentSummary?.agentMismatchCount ?? 0) === 0 &&
          sourceTotal > 0,
        detail:
          installationCount === 0
            ? "ยังไม่ได้ลงทะเบียน Agent"
            : agentCount === 0
              ? "Agent เดิมถูกปิดใช้งานหรือแทนที่แล้ว"
              : (agentSummary?.agentMismatchCount ?? 0) > 0
                ? "Agent รายงาน office.offid ไม่ตรงกับสถานบริการ"
            : (agentSummary?.usableAgentCount ?? 0) === 0
              ? "Agent ไม่มี credential ที่ใช้งานได้"
              : (agentSummary?.onlineAgentCount ?? 0) === 0
                ? "Agent ออฟไลน์"
                : (agentSummary?.jhcisConnectedCount ?? 0) === 0
                  ? (agentSummary?.jhcisUnreachableCount ?? 0) > 0
                    ? "Agent ออนไลน์ · JHCIS ติดต่อไม่ได้"
                    : "Agent ออนไลน์ · ยังไม่ทราบสถานะ JHCIS"
            : sourceTotal === 0
              ? `Agent ออนไลน์ · ยังไม่ได้ดึงรายการยา`
              : `${sourceTotal.toLocaleString("th-TH")} รายการ · ดึงล่าสุด ${formatBangkok(lastSyncAt)}`,
        href: "/jhcis",
        actionLabel:
          agentCount === 0 || (agentSummary?.onlineAgentCount ?? 0) === 0 || (agentSummary?.jhcisConnectedCount ?? 0) === 0
            ? "ตรวจสอบ"
            : "ดึงข้อมูล",
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
        ready: tmtReadiness.ready && latestTtmtImport.length > 0 && ttmtTotal > 0,
        detail:
          !tmtReadiness.ready
            ? "TMT v2 ยังไม่ผ่าน readiness"
            : latestTtmtImport.length === 0 || ttmtTotal === 0
              ? "TMT v2 พร้อม · ยังไม่มี TTMT ที่นำเข้าสำเร็จ"
              : `TMT ${tmtReadiness.assurance === "validated_unverified" ? "พร้อมแบบ degraded" : "ยืนยันเวอร์ชันแล้ว"} · TTMT ${ttmtTotal.toLocaleString("th-TH")} (เวอร์ชัน ${latestTtmtImport[0]?.version})`,
        href: "/standards",
        actionLabel: "เปิด Standards Hub",
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
