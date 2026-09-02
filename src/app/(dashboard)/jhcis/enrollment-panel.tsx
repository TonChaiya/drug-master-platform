"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";

interface Enrollment {
  protocolUrl: string;
  enrollmentToken: string;
  serverUrl: string;
  facilityCode: string;
  expiresAt: string;
}

export function EnrollmentPanel({ installer }: { installer: { url: string; version: string } }) {
  const router = useRouter();
  const { push } = useToast();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function createLink() {
    setBusy("enroll");
    try {
      const response = await fetch("/api/v1/agent-admin/enrollment", { method: "POST" });
      const result = (await response.json()) as { ok?: boolean; message?: string } & Partial<Enrollment>;
      if (!response.ok || !result.ok || !result.protocolUrl) {
        push("error", result.message ?? "สร้างลิงก์ลงทะเบียนไม่สำเร็จ");
        return;
      }
      setEnrollment(result as Enrollment);
      push("ok", "สร้างลิงก์ลงทะเบียนแล้ว ใช้ได้ 10 นาที");
    } finally {
      setBusy(null);
    }
  }

  async function sendCommand(commandType: "sync_now" | "test_connection") {
    setBusy(commandType);
    try {
      const response = await fetch("/api/v1/agent-admin/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandType }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "ส่งคำสั่งไม่สำเร็จ");
        return;
      }
      push("ok", commandType === "sync_now" ? "สั่งดึงรายการยาแล้ว Agent จะรับงานภายในไม่กี่วินาที" : "สั่งทดสอบการเชื่อมต่อแล้ว");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card card-pad space-y-3">
      <div>
        <h2 className="text-sm font-semibold">ลงทะเบียน Agent ที่เครื่องในสถานบริการ</h2>
        <p className="mt-0.5 text-xxs text-slate-500">
          ติดตั้ง Agent บนเครื่องที่อยู่ในวง LAN เดียวกับ JHCIS แล้วเปิดลิงก์ลงทะเบียนบนเครื่องนั้น
          รหัสฐานข้อมูล JHCIS กรอกที่เครื่องเท่านั้น ไม่ถูกส่งขึ้นระบบกลาง
        </p>
      </div>

      {installer.url ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand-100 bg-brand-50 p-2.5">
          <a className="btn-primary btn-sm" href={installer.url} target="_blank" rel="noreferrer noopener">
            ดาวน์โหลดตัวติดตั้ง Agent{installer.version ? ` ${installer.version}` : ""}
          </a>
          <span className="text-xxs text-slate-600">
            ติดตั้งบนเครื่องที่ต่อ JHCIS ได้ ไม่ต้องใช้สิทธิ์ผู้ดูแลเครื่อง โปรแกรมจะอยู่ใน System Tray
          </span>
        </div>
      ) : (
        <p className="rounded-md bg-warn-soft px-2.5 py-2 text-xxs text-warn">
          ยังไม่มีลิงก์ตัวติดตั้ง — ผู้ดูแลระบบส่วนกลางตั้งค่าได้ที่หน้า “ผู้ดูแลระบบ” หัวข้อ “ตัวติดตั้ง Agent”
        </p>
      )}

      <ol className="space-y-1.5 text-xxs text-slate-600">
        <li>1. ดาวน์โหลดและติดตั้ง Agent จากปุ่มด้านบน</li>
        <li>2. กด “สร้างลิงก์ลงทะเบียน” ด้านล่าง แล้วเปิดลิงก์บนเครื่องที่ติดตั้ง Agent</li>
        <li>3. กรอก IP/พอร์ต/รหัสผ่าน JHCIS ในหน้าต่าง Agent แล้วกดทดสอบ</li>
        <li>4. Agent จะอ่าน office.offid และเชื่อมได้ต่อเมื่อตรงกับรหัสสถานบริการนี้</li>
      </ol>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void createLink()}>
          {busy === "enroll" ? "กำลังสร้าง…" : "สร้างลิงก์ลงทะเบียน"}
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => void sendCommand("test_connection")}>
          ทดสอบการเชื่อมต่อ
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => void sendCommand("sync_now")}>
          ดึงรายการยาตอนนี้
        </button>
      </div>

      {enrollment ? (
        <div className="rounded-md border border-brand-100 bg-brand-50 p-2.5">
          <p className="text-xxs font-medium text-brand-700">
            ลิงก์นี้ใช้ได้ครั้งเดียว หมดอายุ {new Date(enrollment.expiresAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}
          </p>
          <a className="mt-1.5 inline-block break-all text-xxs text-brand-700 underline" href={enrollment.protocolUrl}>
            {enrollment.protocolUrl}
          </a>
          <dl className="mt-2 grid gap-1 text-xxs text-slate-600 sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Server URL</dt>
              <dd className="break-all font-mono">{enrollment.serverUrl}</dd>
            </div>
            <div>
              <dt className="text-slate-500">รหัสสถานบริการ</dt>
              <dd className="font-mono">{enrollment.facilityCode}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Enrollment token</dt>
              <dd className="break-all font-mono">{enrollment.enrollmentToken}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}
