"use client";

import { useState } from "react";
import { Alert, Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { type TmtOperationsSnapshot } from "@/modules/tmt/operations";

function stamp(value: string | null): string {
  return value ? new Date(value).toLocaleString("th-TH") : "—";
}

function number(value: number): string {
  return value.toLocaleString("th-TH");
}

export function TmtOperationsPanel({ initial }: { initial: TmtOperationsSnapshot }) {
  const [operations, setOperations] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { readiness, latestRun } = operations;

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/admin/tmt-operations");
      const body = (await response.json()) as { ok?: boolean; operations?: TmtOperationsSnapshot; message?: string };
      if (!response.ok || !body.ok || !body.operations) throw new Error(body.message ?? "โหลดสถานะ TMT ไม่สำเร็จ");
      setOperations(body.operations);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดสถานะ TMT ไม่สำเร็จ");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={readiness.ready ? "success" : "danger"}>{readiness.ready ? readiness.assurance : readiness.reason}</Badge>
        {latestRun ? <Badge>{latestRun.mode}</Badge> : null}
        <Button size="sm" className="ml-auto" loading={refreshing} onClick={() => void refresh()}>รีเฟรชสถานะ</Button>
      </div>
      {readiness.assurance === "validated_unverified" ? <Alert tone="warning" title="พร้อมใช้แบบ validated_unverified">ผ่าน validation ที่บันทึกไว้แล้ว แต่ upstream ยังไม่ยืนยันเวอร์ชัน</Alert> : null}
      <Alert tone="info" title="การซิงก์ TMT ทำผ่าน CLI เท่านั้น">คำสั่งปัจจุบันต้องยืนยัน environment/database, mode และ guard สำหรับงานที่อาจใช้เวลานาน จึงไม่เริ่มหรือ resume จาก web request</Alert>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <dl className="grid gap-2 text-xxs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="type-caption">สถานะล่าสุด</dt><dd className="mt-0.5 font-medium">{latestRun?.status ?? "ยังไม่มี run"}</dd></div>
        <div><dt className="type-caption">เริ่มเมื่อ</dt><dd className="mt-0.5">{stamp(latestRun?.startedAt ?? null)}</dd></div>
        <div><dt className="type-caption">รับ / บันทึก</dt><dd className="mt-0.5 tabular-nums">{latestRun ? `${number(latestRun.receivedRows)} / ${number(latestRun.writtenRows)}` : "—"}</dd></div>
        <div><dt className="type-caption">คำเตือน / ข้อผิดพลาด</dt><dd className="mt-0.5">{latestRun ? `${number(latestRun.warningsCount)}${latestRun.errorCode ? ` · ${latestRun.errorCode}` : ""}` : "—"}</dd></div>
      </dl>

      <TableScroll maxHeight="16rem"><Table><thead><tr><th>Run ล่าสุด</th><th>โหมด</th><th>สถานะ</th><th>รับ / บันทึก</th><th>เริ่ม</th><th>จบ</th></tr></thead><tbody>
        {operations.runs.length === 0 ? <TableMessage colSpan={6}>ยังไม่มีประวัติ TMT sync</TableMessage> : operations.runs.map((run) => (
          <tr key={run.id}><td className="cell-code" title={run.id}>{run.tmtVersion}</td><td>{run.mode}</td><td><StatusBadge status={run.status} /></td><td className="cell-num">{number(run.receivedRows)} / {number(run.writtenRows)}</td><td>{stamp(run.startedAt)}</td><td>{stamp(run.finishedAt)}</td></tr>
        ))}
      </tbody></Table></TableScroll>

      {latestRun ? <TableScroll maxHeight="14rem"><Table><thead><tr><th>Endpoint</th><th>ช่วงข้อมูล</th><th>สถานะ</th><th>ครั้ง</th><th>รับ / บันทึก</th><th>ข้อผิดพลาด</th></tr></thead><tbody>
        {operations.checkpoints.length === 0 ? <TableMessage colSpan={6}>ยังไม่มี checkpoint สำหรับ run ล่าสุด</TableMessage> : operations.checkpoints.map((checkpoint) => (
          <tr key={`${checkpoint.endpoint}:${checkpoint.windowBegin}:${checkpoint.windowEnd}`}><td className="cell-code">{checkpoint.endpoint}</td><td>{checkpoint.windowBegin} – {checkpoint.windowEnd}</td><td><StatusBadge status={checkpoint.status} /></td><td className="cell-num">{number(checkpoint.attemptCount)}</td><td className="cell-num">{number(checkpoint.receivedRows)} / {number(checkpoint.writtenRows)}</td><td className="cell-code">{checkpoint.errorCode ?? "—"}</td></tr>
        ))}
      </tbody></Table></TableScroll> : null}
    </div>
  );
}
