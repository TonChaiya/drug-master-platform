"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { StandardSearch } from "@/components/standard-search";

export interface SyncProgress {
  status: string;
  beginDate: string | null;
  endDate: string | null;
  completedWindows: number;
  totalWindows: number;
  percent: number;
  receivedRows: number;
  changedRows: number;
  errorCode: string | null;
  resumable: boolean;
}

export function StandardsPanel({ isAdmin, initialProgress }: { isAdmin: boolean; initialProgress: SyncProgress | null }) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState<SyncProgress | null>(initialProgress);
  const polling = useRef(false);

  const readProgress = useCallback(async () => {
    const response = await fetch("/api/v1/standards/sync");
    if (!response.ok) return;
    const body = (await response.json()) as { progress?: SyncProgress | null };
    setProgress(body.progress ?? null);
  }, []);

  // The sync request does not return until the whole load finishes, which is
  // minutes on a first run. Poll the run row so the bar moves in the meantime.
  useEffect(() => {
    if (busy !== "sync" || polling.current) return;
    polling.current = true;
    const timer = setInterval(() => void readProgress(), 2000);
    return () => {
      clearInterval(timer);
      polling.current = false;
    };
  }, [busy, readProgress]);

  async function runSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("sync");
    setWarnings([]);
    try {
      const response = await fetch("/api/v1/standards/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beginDate: form.get("beginDate"), endDate: form.get("endDate") }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        received?: number;
        written?: number;
        version?: string | null;
        warnings?: string[];
      };
      await readProgress();
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "sync ไม่สำเร็จ");
        return;
      }
      setWarnings(result.warnings ?? []);
      push("ok", `sync สำเร็จ: รับ ${result.received?.toLocaleString("th-TH")} รายการ (เวอร์ชัน ${result.version ?? "ไม่ทราบ"})`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function importTtmt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy("ttmt");
    setWarnings([]);
    try {
      const response = await fetch("/api/v1/standards/ttmt-import", { method: "POST", body: new FormData(form) });
      const result = (await response.json()) as { ok?: boolean; message?: string; rowCount?: number; details?: string[]; warnings?: string[] };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "นำเข้าไม่สำเร็จ");
        setWarnings(result.details ?? []);
        return;
      }
      setWarnings(result.warnings ?? []);
      push("ok", `นำเข้า MasterTTMT สำเร็จ ${result.rowCount?.toLocaleString("th-TH")} รายการ`);
      form.reset();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {isAdmin ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="card card-pad">
            <h2 className="text-sm font-semibold">ซิงก์ MasterTMT จาก TMT API</h2>
            <p className="mt-0.5 text-xxs text-slate-500">
              ระบบแบ่งช่วงวันที่เป็นรอบละไม่เกิน 1 ปี และ enrich ISED จาก /nlem กับเลขทะเบียนจาก /regno ให้อัตโนมัติ
              ข้อมูลชุดแรกของ TMT อยู่เดือนพฤศจิกายน 2013 หากดึงแล้วหลุดกลางทาง กดปุ่มเดิมอีกครั้งเพื่อทำต่อจากช่วงที่ค้าง ไม่ต้องเริ่มใหม่
            </p>
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={runSync}>
              <div>
                <label className="label" htmlFor="beginDate">ตั้งแต่วันที่</label>
                <input className="field" id="beginDate" name="beginDate" type="date" required defaultValue="2013-01-01" />
              </div>
              <div>
                <label className="label" htmlFor="endDate">ถึงวันที่</label>
                <input className="field" id="endDate" name="endDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <button className="btn-primary btn-sm" disabled={busy !== null}>
                {busy === "sync" ? "กำลังซิงก์…" : progress?.resumable ? "ทำต่อจากที่ค้าง" : "เริ่มซิงก์"}
              </button>
            </form>

            {progress ? (
              <div className="mt-3" role="status" aria-live="polite">
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xxs">
                  <span className="font-medium text-slate-700">
                    {busy === "sync"
                      ? "กำลังดึงข้อมูล…"
                      : progress.status === "succeeded"
                        ? "ซิงก์ล่าสุดสำเร็จ"
                        : progress.resumable
                          ? "ค้างอยู่ กดปุ่มเพื่อทำต่อ"
                          : "สถานะ " + progress.status}
                  </span>
                  <span className="tabular-nums text-slate-500">{progress.percent}%</span>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${
                      progress.status === "failed" && busy !== "sync" ? "bg-danger" : "bg-brand-600"
                    }`}
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>

                <p className="mt-1 text-xxs text-slate-500">
                  ช่วง {progress.completedWindows.toLocaleString("th-TH")}/{progress.totalWindows.toLocaleString("th-TH")} ·
                  ดึงมาแล้ว {progress.receivedRows.toLocaleString("th-TH")} รายการ · บันทึก{" "}
                  {progress.changedRows.toLocaleString("th-TH")} รายการ
                  {progress.beginDate ? ` · ${progress.beginDate} ถึง ${progress.endDate}` : ""}
                </p>

                {progress.errorCode && busy !== "sync" ? (
                  <p className="mt-1 text-xxs text-danger">
                    หยุดด้วยข้อผิดพลาด {progress.errorCode} — กดปุ่มอีกครั้งเพื่อทำต่อจากช่วงที่ค้าง
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold">นำเข้า MasterTTMT จากไฟล์</h2>
            <p className="mt-0.5 text-xxs text-slate-500">
              คู่มือ TMT API ไม่ได้ระบุ endpoint ของ TTMT ระบบจึงนำเข้าจากไฟล์ที่อนุมัติ และเก็บเวอร์ชัน/ประวัติแยกจาก TMT
            </p>
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={importTtmt}>
              <div>
                <label className="label" htmlFor="version">เวอร์ชันไฟล์</label>
                <input className="field" id="version" name="version" required placeholder="20260715" maxLength={120} />
              </div>
              <div className="min-w-48 flex-1">
                <label className="label" htmlFor="ttmtFile">ไฟล์ (.xls / .xlsx)</label>
                <input className="field" id="ttmtFile" name="file" type="file" accept=".xls,.xlsx" required />
              </div>
              <button className="btn-primary btn-sm" disabled={busy !== null}>
                {busy === "ttmt" ? "กำลังนำเข้า…" : "นำเข้า"}
              </button>
            </form>
          </section>
        </div>
      ) : (
        <p className="card card-pad text-xxs text-slate-500">
          การซิงก์และนำเข้าคลังมาตรฐานทำได้เฉพาะผู้ดูแลระบบ ผู้ใช้ทั่วไปใช้หน้านี้เพื่อค้นหารหัสมาตรฐาน
        </p>
      )}

      {warnings.length > 0 ? (
        <section className="card card-pad border-warn/30 bg-warn-soft">
          <h3 className="text-xxs font-semibold text-warn">ข้อสังเกตด้านคุณภาพข้อมูล ({warnings.length})</h3>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xxs text-warn">
            {warnings.slice(0, 20).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card card-pad">
        <h2 className="mb-2 text-sm font-semibold">ค้นหารหัสมาตรฐาน</h2>
        <StandardSearch />
      </section>
    </div>
  );
}
