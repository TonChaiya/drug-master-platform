"use client";

import { useMemo, useState } from "react";
import type { FacilityCondition } from "@/modules/admin/condition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { IconShield } from "@/components/ui/icons";

export interface FacilityOverviewRow {
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  sourceTotal: number;
  type01: number;
  type10: number;
  mappedTotal: number;
  pendingTotal: number;
  needsReviewTotal: number;
  installationCount: number;
  agentCount: number;
  disabledAgentCount: number;
  supersededAgentCount: number;
  usableAgentCount: number;
  onlineAgentCount: number;
  offlineAgentCount: number;
  jhcisConnectedCount: number;
  jhcisUnreachableCount: number;
  jhcisUnknownCount: number;
  agentMismatchCount: number;
  activeAccountCount: number;
  pendingAccountCount: number;
  disabledAccountCount: number;
  lastMappedAtLabel: string | null;
  mappedPercent: number;
  condition: FacilityCondition;
}

type ConditionFilter = "all" | FacilityCondition["tone"];

const FILTER_LABEL: Record<ConditionFilter, string> = {
  all: "ทั้งหมด",
  danger: "ต้องแก้",
  warning: "รอดำเนินการ",
  success: "พร้อม",
  neutral: "ทั่วไป",
};

export function FacilityOverviewTable({ rows }: { rows: FacilityOverviewRow[] }) {
  const [filter, setFilter] = useState<ConditionFilter>("all");
  const counts = useMemo(() => {
    const result: Record<ConditionFilter, number> = { all: rows.length, danger: 0, warning: 0, success: 0, neutral: 0 };
    for (const row of rows) result[row.condition.tone] += 1;
    return result;
  }, [rows]);
  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((row) => row.condition.tone === filter)),
    [filter, rows],
  );
  const filters: ConditionFilter[] = ["all", "danger", "warning", "success"];

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-2.5 sm:px-4" aria-label="กรองสถานบริการตามสถานะ">
        {filters.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "primary" : "outline"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {FILTER_LABEL[value]} {counts[value].toLocaleString("th-TH")}
          </Button>
        ))}
        <span className="type-caption ml-auto tabular-nums" role="status" aria-live="polite">
          แสดง {visible.length.toLocaleString("th-TH")} จาก {rows.length.toLocaleString("th-TH")} แห่ง
        </span>
      </div>

      <TableScroll>
        <Table>
          <thead>
            <tr>
              <th>สถานะ</th>
              <th>สถานบริการ</th>
              <th>รายการยาจาก JHCIS</th>
              <th>จับคู่มาตรฐาน</th>
              <th>บัญชี</th>
              <th>Agent</th>
              <th>จับคู่ล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <TableMessage colSpan={7}>
                <EmptyState
                  compact
                  icon={<IconShield size={18} />}
                  title="ยังไม่มีสถานบริการที่เปิดใช้งาน"
                  description="สถานบริการถูกสร้างขึ้นเมื่อบัญชีแรกของรหัสนั้นสมัครสมาชิก"
                />
              </TableMessage>
            ) : visible.length === 0 ? (
              <TableMessage colSpan={7}>
                <EmptyState compact title="ไม่มีสถานบริการในสถานะนี้" description="เลือก “ทั้งหมด” เพื่อดูทุกสถานบริการ" />
              </TableMessage>
            ) : (
              visible.map((row) => (
                <tr key={row.facilityId}>
                  <td>
                    <Badge tone={row.condition.tone} dot title={row.condition.detail}>
                      {row.condition.label}
                    </Badge>
                  </td>

                  <td className="max-w-64">
                    <div className="flex items-baseline gap-1.5">
                      <span className="cell-code text-slate-600">{row.facilityCode}</span>
                      <span className="font-medium">{row.facilityName}</span>
                    </div>
                    {row.condition.needsAttention ? (
                      <p className="type-help mt-0.5 line-clamp-1 text-slate-600" title={row.condition.detail}>
                        {row.condition.detail}
                      </p>
                    ) : null}
                  </td>

                  <td className="cell-num">
                    {row.sourceTotal === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <>
                        <div className="font-medium">{row.sourceTotal.toLocaleString("th-TH")}</div>
                        <div className="type-help text-slate-600">
                          01: {row.type01.toLocaleString("th-TH")} · 10: {row.type10.toLocaleString("th-TH")}
                        </div>
                      </>
                    )}
                  </td>

                  <td className="whitespace-nowrap">
                    {row.sourceTotal === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <>
                        <div className="font-semibold tabular-nums text-slate-800">
                          {row.mappedTotal.toLocaleString("th-TH")} / {row.sourceTotal.toLocaleString("th-TH")} · {row.mappedPercent}%
                        </div>
                        <div className={row.needsReviewTotal + row.pendingTotal > 0 ? "type-help text-warning" : "type-help text-slate-600"}>
                          ตรวจ {row.needsReviewTotal.toLocaleString("th-TH")} · ค้าง {row.pendingTotal.toLocaleString("th-TH")}
                        </div>
                      </>
                    )}
                  </td>

                  <td>
                    <div className="flex max-w-44 flex-wrap gap-1">
                      <Badge tone={row.activeAccountCount > 0 ? "success" : "danger"}>
                        ใช้งาน {row.activeAccountCount.toLocaleString("th-TH")}
                      </Badge>
                      {row.pendingAccountCount > 0 ? <Badge tone="warning">รอ {row.pendingAccountCount.toLocaleString("th-TH")}</Badge> : null}
                      {row.disabledAccountCount > 0 ? <Badge>ปิดใช้ {row.disabledAccountCount.toLocaleString("th-TH")}</Badge> : null}
                    </div>
                  </td>

                  <td className="min-w-44">
                    {row.installationCount === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : row.agentCount === 0 ? (
                      <div>
                        <Badge tone="danger">ไม่มี Agent ที่ใช้งาน</Badge>
                        <div className="type-help mt-0.5 text-slate-600">
                          ปิดใช้ {row.disabledAgentCount.toLocaleString("th-TH")} · แทนที่ {row.supersededAgentCount.toLocaleString("th-TH")}
                        </div>
                      </div>
                    ) : (
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {row.agentMismatchCount > 0 ? <Badge tone="danger">รหัสไม่ตรง {row.agentMismatchCount.toLocaleString("th-TH")}</Badge> : null}
                        <Badge tone={row.onlineAgentCount > 0 ? "success" : "neutral"} dot>
                          {row.onlineAgentCount > 0 ? `ออนไลน์ ${row.onlineAgentCount}` : "ออฟไลน์"}
                        </Badge>
                        {row.agentMismatchCount === 0 ? (
                          <Badge tone={row.usableAgentCount > 0 ? "success" : "danger"}>
                            {row.usableAgentCount > 0 ? "Credential พร้อม" : "Credential ไม่พร้อม"}
                          </Badge>
                        ) : null}
                        <Badge tone={row.jhcisConnectedCount > 0 ? "success" : row.jhcisUnreachableCount > 0 ? "danger" : "neutral"}>
                          {row.jhcisConnectedCount > 0
                            ? "JHCIS พร้อม"
                            : row.jhcisUnreachableCount > 0
                              ? "JHCIS ติดต่อไม่ได้"
                              : "JHCIS ยังไม่ทราบ"}
                        </Badge>
                        {row.offlineAgentCount > 0 && row.onlineAgentCount > 0 ? <Badge>ออฟไลน์ {row.offlineAgentCount.toLocaleString("th-TH")}</Badge> : null}
                      </div>
                    )}
                  </td>

                  <td className="whitespace-nowrap">{row.lastMappedAtLabel ?? <span className="text-slate-400">—</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableScroll>
    </>
  );
}
