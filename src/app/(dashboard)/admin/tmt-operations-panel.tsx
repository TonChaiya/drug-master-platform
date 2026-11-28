"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { type TmtOperationsSnapshot } from "@/modules/tmt/operations";

function stamp(value: string | null): string {
  return value ? new Date(value).toLocaleString("th-TH") : "—";
}

function number(value: number): string {
  return value.toLocaleString("th-TH");
}

function RunStatus({ status }: { status: string }) {
  if (status === "stale") return <Badge tone="warning" dot>เวอร์ชันเปลี่ยน</Badge>;
  if (status === "unverified") return <Badge tone="warning" dot>ยังไม่ยืนยันเวอร์ชัน</Badge>;
  return <StatusBadge status={status} />;
}

function failureGuidance(mode: string, errorCode: string | null) {
  if (mode === "full_unverified") return "การซิงก์แบบ Full-unverified ทำต่อจากจุดที่ค้างไม่ได้ ให้ผู้ดูแลตรวจ checkpoint ที่ล้มเหลว";
  if (errorCode === "TMT_HTTP_401" || errorCode === "TMT_HTTP_403") return "ให้ผู้ดูแลตรวจสิทธิ์การเข้าถึง TMT API ฝั่งเซิร์ฟเวอร์ก่อนดำเนินการต่อ";
  if (errorCode === "TMT_HTTP_429") return "TMT API จำกัดจำนวนคำขอ ให้รอพ้นช่วงจำกัดและตรวจเวอร์ชันก่อนดำเนินการต่อ";
  if (errorCode === "TMT_TIMEOUT" || /^TMT_HTTP_5\d\d$/.test(errorCode ?? "")) return "ตรวจว่า TMT API กลับมาให้บริการและเวอร์ชันตรงกับ run ก่อนดำเนินการต่อ";
  return "ตรวจรหัสข้อผิดพลาดและ checkpoint ด้านล่างก่อนพิจารณาทำต่อผ่าน guarded CLI สำหรับ run ที่เข้าเงื่อนไข";
}

function CandidateControls({ candidate, onChanged }: {
  candidate: NonNullable<TmtOperationsSnapshot["candidateOperations"]>;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"full" | "incremental">("incremental");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const pendingStart = useRef<{ input: string; id: string } | null>(null);
  const active = candidate.jobs.some((job) => job.status === "queued" || job.status === "running");
  const enabled = candidate.controlsEnabled && Boolean(candidate.pointer.datasetId);

  async function submit(data: object, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/admin/tmt-operations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      const body = await response.json() as { ok: boolean; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.message ?? "ส่งคำสั่งไม่สำเร็จ");
      setNotice({ error: false, text: success });
      await onChanged();
      return true;
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "ส่งคำสั่งไม่สำเร็จ" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const input = { mode, begin: String(fields.get("begin") || "") || undefined, end: String(fields.get("end") || "") || undefined };
    const key = JSON.stringify(input);
    if (pendingStart.current?.input !== key) pendingStart.current = { input: key, id: crypto.randomUUID() };
    if (await submit({ action: "start", ...input, id: pendingStart.current.id }, "รับงานแล้ว เปิดหน้านี้ภายหลังเพื่อติดตามได้")) pendingStart.current = null;
  }

  function switchDataset(action: "promote" | "rollback", id: string) {
    const label = action === "promote" ? "อนุมัติชุดข้อมูล" : "ย้อนกลับชุดข้อมูล";
    if (window.confirm(`${label} ${id}?`)) void submit({ action, id, generation: candidate.pointer.generation, confirm: `${action.toUpperCase()} ${id}` }, "เปลี่ยนชุดข้อมูลที่ใช้งานแล้ว");
  }

  return (
    <section className="space-y-2" aria-label="ชุดข้อมูล TMT">
      <p className="type-help">ชุดที่ใช้งาน {candidate.pointer.datasetId ?? "รอรับรองชุดข้อมูลฐาน"}{candidate.pointer.assurance ? ` · ${candidate.pointer.assurance}` : ""}</p>
      {!enabled ? <Alert tone="info">การสั่งงาน TMT ผ่านเว็บยังไม่เปิดใช้งาน หรือยังไม่ได้รับรองชุดข้อมูลฐาน</Alert> : null}
      {enabled ? (
        <form onSubmit={(event) => void start(event)} className="grid gap-2 sm:grid-cols-2">
          <label className="type-caption grid gap-1">โหมด<select className="input" value={mode} onChange={(e) => setMode(e.target.value === "full" ? "full" : "incremental")}><option value="incremental">Incremental</option><option value="full">Full</option></select></label>
          <label className="type-caption grid gap-1">วันสิ้นสุด (วันนี้ตามเวลาไทย)<input className="input" name="end" type="date" /></label>
          {mode === "incremental" ? <label className="type-caption grid gap-1">วันเริ่มต้น (เว้นว่างเพื่อใช้ช่วงต่อเนื่องจากชุดฐาน)<input className="input" name="begin" type="date" min="2013-01-01" /></label> : <p className="type-help self-center">Full เริ่มวันที่ 2013-01-01</p>}
          <Button type="submit" size="sm" className="self-end" disabled={active || busy} loading={busy}>เริ่มซิงก์</Button>
        </form>
      ) : null}
      {notice ? <Alert tone={notice.error ? "danger" : "success"}>{notice.text}</Alert> : null}
      {candidate.jobs.map((job) => (
        <div key={job.id} className="space-y-1 rounded border border-slate-200 p-2 text-xxs">
          <div className="flex flex-wrap items-center gap-2">
            <span>{job.mode} · {job.version}</span>
            {job.status === "validated" ? <Badge tone="success">ผ่านการตรวจสอบ</Badge> : <RunStatus status={job.status} />}
            {enabled && job.resumable ? <Button size="sm" disabled={busy} onClick={() => void submit({ action: "resume", id: job.id }, "ส่งงานไปทำต่อแล้ว")}>ทำต่อจากจุดที่ค้าง</Button> : null}
            {enabled && job.promotable ? <Button size="sm" disabled={busy} onClick={() => switchDataset("promote", job.id)}>อนุมัติและเปิดใช้</Button> : null}
          </div>
          <ProgressBar value={job.completed} max={job.total} label={`Checkpoint ${job.completed} / ${job.total}`} />
          <p>รับ / บันทึก {number(job.received)} / {number(job.written)} · คำเตือน {number(job.warnings)}{job.errorCode ? ` · ${job.errorCode}` : ""}</p>
          {job.processing ? <p>กำลังทำ {job.processing.endpoint} · {job.processing.window.begindate} – {job.processing.window.enddate}</p> : null}
        </div>
      ))}
      {enabled ? candidate.accepted.filter((item) => item.id !== candidate.pointer.datasetId).map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-2 text-xxs"><span>{item.version} · {item.assurance}</span><Button size="sm" disabled={busy} onClick={() => switchDataset("rollback", item.id)}>ย้อนกลับชุดนี้</Button></div>
      )) : null}
    </section>
  );
}

export function TmtOperationsPanel({ initial }: { initial: TmtOperationsSnapshot }) {
  const [operations, setOperations] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const { readiness, latestRun, progress } = operations;
  const acceptedAssurance = operations.candidateOperations?.pointer.assurance;
  const assurance = acceptedAssurance ?? readiness.assurance;
  const isRunning = latestRun?.status === "running";
  const isActive = isRunning || latestRun?.status === "queued"
    || operations.candidateOperations?.jobs.some((job) => job.status === "queued" || job.status === "running");
  const settled = progress ? progress.succeeded + progress.failed : 0;
  const percent = progress ? Math.floor((settled / progress.total) * 100) : 0;
  const last = progress?.latestRecorded;

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    setError(null);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
      const response = await fetch("/api/v1/admin/tmt-operations", { signal, cache: "no-store" });
      const body = (await response.json()) as { ok?: boolean; operations?: TmtOperationsSnapshot; message?: string };
      if (!response.ok || !body.ok || !body.operations) throw new Error(body.message ?? "โหลดสถานะ TMT ไม่สำเร็จ");
      if (!controller.signal.aborted) setOperations(body.operations);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดสถานะ TMT ไม่สำเร็จ");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), isActive ? 15_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [isActive, refresh]);
  useEffect(() => () => {
    const controller = request.current;
    request.current = null;
    controller?.abort();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={assurance ? "success" : "danger"}>{assurance ?? readiness.reason}</Badge>
        {latestRun ? <Badge>{latestRun.mode}</Badge> : null}
        <Button size="sm" className="ml-auto" loading={refreshing} onClick={() => void refresh()}>รีเฟรชสถานะ</Button>
      </div>
      {assurance === "validated_unverified" ? <Alert tone="warning" title="พร้อมใช้แบบ validated_unverified">ผ่านการตรวจสอบที่บันทึกไว้แล้ว และยังไม่มีหลักฐานยืนยันเวอร์ชันสำหรับชุดข้อมูลทั้งหมด</Alert> : null}
      {operations.candidateOperations ? <CandidateControls candidate={operations.candidateOperations} onChanged={refresh} /> : <Alert tone="info" title="เริ่มและทำต่อผ่านเว็บยังไม่เปิดใช้">
        Full และ Incremental ต้องมีพื้นที่เตรียมชุดข้อมูลแยกจากชุดที่ใช้งานอยู่และตัวรันที่ทำงานต่อได้เมื่อปิดหน้าเว็บ การซิงก์แบบ Full-unverified ทำต่อจากจุดที่ค้างไม่ได้
      </Alert>}
      {latestRun?.status === "stale" ? (
        <Alert tone="warning" title="เวอร์ชันต้นทางเปลี่ยนระหว่างซิงก์">ตรวจเวอร์ชันกับผู้ดูแล หยุดการทำต่อจาก checkpoint ของเวอร์ชันเดิม</Alert>
      ) : latestRun?.status === "failed" ? (
        <Alert tone="danger" title="ซิงก์ล้มเหลว">
          {failureGuidance(latestRun.mode, latestRun.errorCode)}
        </Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <dl className="grid gap-2 text-xxs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="type-caption">สถานะล่าสุด</dt><dd className="mt-0.5 font-medium">{latestRun ? <RunStatus status={latestRun.status} /> : "ยังไม่มี run"}</dd></div>
        <div><dt className="type-caption">เริ่มเมื่อ</dt><dd className="mt-0.5">{stamp(latestRun?.startedAt ?? null)}</dd></div>
        <div><dt className="type-caption">รับ / บันทึก</dt><dd className="mt-0.5 tabular-nums">{progress ? `${number(progress.receivedRows)} / ${number(progress.writtenRows)}` : "—"}</dd></div>
        <div><dt className="type-caption">คำเตือน / ข้อผิดพลาด</dt><dd className="mt-0.5">{latestRun ? `${number(latestRun.warningsCount)}${latestRun.errorCode ? ` · ${latestRun.errorCode}` : ""}` : "—"}</dd></div>
      </dl>

      {progress ? (
        <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-2 text-xxs" aria-live="polite">
          <ProgressBar value={percent} tone={progress.failed ? "warning" : "info"} label={`รายงานผลแล้ว ${number(settled)} / ${number(progress.total)} checkpoint ที่ลงทะเบียน`} />
          <p>สำเร็จ {number(progress.succeeded)} · ไม่สำเร็จ {number(progress.failed)} · ยังไม่มีผล {number(progress.total - settled)}</p>
          <p>ช่วงข้อมูลที่ลงทะเบียน {progress.windowBegin} – {progress.windowEnd}</p>
          {last ? <p className="break-words">Checkpoint ที่รายงานล่าสุด {last.endpoint} · {last.windowBegin} – {last.windowEnd} · <RunStatus status={last.status} /></p> : null}
          {isRunning && settled === progress.total ? <p>ยังรอผลตรวจเวอร์ชันและสถานะสุดท้ายของ run</p> : null}
          {isActive ? <p className="type-caption">รีเฟรชสถานะทุก 15 วินาที · ระบบรายงาน endpoint เมื่อ checkpoint มีผลแล้ว</p> : null}
        </div>
      ) : isActive ? <p className="type-caption">ยังไม่มี checkpoint ที่ลงทะเบียน · รีเฟรชสถานะทุก 15 วินาที</p> : null}

      <TableScroll maxHeight="16rem"><Table><thead><tr><th>Run ล่าสุด</th><th>โหมด</th><th>สถานะ</th><th>รับ / บันทึก</th><th>เริ่ม</th><th>จบ</th></tr></thead><tbody>
        {operations.runs.length === 0 ? <TableMessage colSpan={6}>ยังไม่มีประวัติ TMT sync</TableMessage> : operations.runs.map((run) => (
          <tr key={run.id}><td className="cell-code" title={run.id}>{run.tmtVersion}</td><td>{run.mode}</td><td><RunStatus status={run.status} />{run.errorCode ? <div className="break-words text-xxs">{run.errorCode}</div> : null}{run.warningsCount > 0 ? <div className="text-xxs">คำเตือน {number(run.warningsCount)}</div> : null}</td><td className="cell-num">{number(run.receivedRows)} / {number(run.writtenRows)}</td><td>{stamp(run.startedAt)}</td><td>{stamp(run.finishedAt)}</td></tr>
        ))}
      </tbody></Table></TableScroll>

      {progress && operations.checkpoints.length < progress.total ? <p className="type-caption">แสดง {number(operations.checkpoints.length)} จาก {number(progress.total)} checkpoint โดยเรียงผลล่าสุดก่อน</p> : null}
      {latestRun ? <TableScroll maxHeight="14rem"><Table><thead><tr><th>Endpoint</th><th>ช่วงข้อมูล</th><th>สถานะ</th><th>ครั้ง</th><th>รับ / บันทึก</th><th>ข้อผิดพลาด</th></tr></thead><tbody>
        {operations.checkpoints.length === 0 ? <TableMessage colSpan={6}>ยังไม่มี checkpoint สำหรับ run ล่าสุด</TableMessage> : operations.checkpoints.map((checkpoint) => (
          <tr key={`${checkpoint.endpoint}:${checkpoint.windowBegin}:${checkpoint.windowEnd}`}><td className="cell-code">{checkpoint.endpoint}</td><td>{checkpoint.windowBegin} – {checkpoint.windowEnd}</td><td><StatusBadge status={checkpoint.status} /></td><td className="cell-num">{number(checkpoint.attemptCount)}</td><td className="cell-num">{number(checkpoint.receivedRows)} / {number(checkpoint.writtenRows)}</td><td className="cell-code">{checkpoint.errorCode ?? "—"}</td></tr>
        ))}
      </tbody></Table></TableScroll> : null}
    </div>
  );
}
