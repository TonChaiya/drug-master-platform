"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { StandardSearch } from "@/components/standard-search";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FileInput, TextInput } from "@/components/ui/form";
import { ProgressBar } from "@/components/ui/states";
import { IconRefresh, IconSearch, IconUpload } from "@/components/ui/icons";

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

  const running = busy === "sync";
  const failed = progress?.status === "failed" && !running;

  return (
    <div className="space-y-3.5">
      {isAdmin ? (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="ซิงก์ MasterTMT จาก TMT API"
              description="ระบบแบ่งช่วงวันที่เป็นรอบละไม่เกิน 1 ปี และเติม ISED จาก /nlem กับเลขทะเบียนจาก /regno ให้อัตโนมัติ ข้อมูลชุดแรกของ TMT อยู่เดือนพฤศจิกายน 2013"
            />
            <CardBody>
              <form className="flex flex-wrap items-end gap-2.5" onSubmit={runSync}>
                <Field label="ตั้งแต่วันที่" htmlFor="beginDate">
                  <TextInput id="beginDate" name="beginDate" type="date" required defaultValue="2013-01-01" className="w-40" />
                </Field>
                <Field label="ถึงวันที่" htmlFor="endDate">
                  <TextInput
                    id="endDate"
                    name="endDate"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className="w-40"
                  />
                </Field>
                <Button type="submit" variant="primary" icon={<IconRefresh size={15} />} loading={running} disabled={busy !== null}>
                  {progress?.resumable ? "ทำต่อจากที่ค้าง" : "เริ่มซิงก์"}
                </Button>
              </form>

              {progress ? (
                <div className="mt-3.5 border-t border-border pt-3.5" role="status" aria-live="polite">
                  <ProgressBar
                    value={progress.percent}
                    tone={failed ? "danger" : progress.status === "succeeded" ? "success" : "info"}
                    label={
                      running
                        ? "กำลังดึงข้อมูล…"
                        : progress.status === "succeeded"
                          ? "ซิงก์ล่าสุดสำเร็จ"
                          : progress.resumable
                            ? "ค้างอยู่ กดปุ่มเพื่อทำต่อ"
                            : `สถานะ ${progress.status}`
                    }
                  />
                  <p className="type-help mt-2">
                    ช่วง {progress.completedWindows.toLocaleString("th-TH")}/{progress.totalWindows.toLocaleString("th-TH")} ·
                    ดึงมาแล้ว {progress.receivedRows.toLocaleString("th-TH")} รายการ · บันทึก{" "}
                    {progress.changedRows.toLocaleString("th-TH")} รายการ
                    {progress.beginDate ? ` · ${progress.beginDate} ถึง ${progress.endDate}` : ""}
                  </p>

                  {progress.errorCode && !running ? (
                    <Alert tone="danger" className="mt-2.5" title={`หยุดด้วยข้อผิดพลาด ${progress.errorCode}`}>
                      กดปุ่มอีกครั้งเพื่อทำต่อจากช่วงที่ค้าง ระบบจะไม่เริ่มดึงใหม่ทั้งหมด
                    </Alert>
                  ) : null}
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="นำเข้า MasterTTMT จากไฟล์"
              description="คู่มือ TMT API ไม่ได้ระบุ endpoint ของ TTMT ระบบจึงนำเข้าจากไฟล์ที่อนุมัติ และเก็บเวอร์ชันกับประวัติแยกจาก TMT"
            />
            <CardBody>
              <form className="flex flex-wrap items-end gap-2.5" onSubmit={importTtmt}>
                <Field label="เวอร์ชันไฟล์" htmlFor="version">
                  <TextInput id="version" name="version" required placeholder="20260715" maxLength={120} mono className="w-40" />
                </Field>
                <Field label="ไฟล์ (.xls / .xlsx)" htmlFor="ttmtFile" className="min-w-48 flex-1">
                  <FileInput id="ttmtFile" name="file" accept=".xls,.xlsx" required />
                </Field>
                <Button type="submit" variant="primary" icon={<IconUpload size={15} />} loading={busy === "ttmt"} disabled={busy !== null}>
                  นำเข้า
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      ) : (
        <Alert tone="info" title="คลังมาตรฐานใช้ร่วมกันทั้งระบบ">
          การซิงก์และนำเข้าคลังมาตรฐานทำได้เฉพาะผู้ดูแลระบบ หน้านี้ใช้สำหรับค้นหารหัสมาตรฐานเพื่อประกอบการจับคู่
        </Alert>
      )}

      {warnings.length > 0 ? (
        <Alert tone="warning" title={`ข้อสังเกตด้านคุณภาพข้อมูล (${warnings.length})`}>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {warnings.slice(0, 20).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader icon={<IconSearch size={16} />} title="ค้นหารหัสมาตรฐาน" description="ค้นได้จากรหัส ชื่อการค้า ชื่อสามัญ ผู้ผลิต หรือเลขทะเบียนยา" />
        <CardBody>
          <StandardSearch />
        </CardBody>
      </Card>
    </div>
  );
}
