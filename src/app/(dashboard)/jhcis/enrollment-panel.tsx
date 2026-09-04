"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, ExternalButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { IconDownload, IconLink, IconPlug, IconRefresh } from "@/components/ui/icons";

interface Enrollment {
  protocolUrl: string;
  enrollmentToken: string;
  serverUrl: string;
  facilityCode: string;
  expiresAt: string;
}

/** How long to keep watching for the agent to appear, and how often to look. */
const WAIT_MS = 90_000;
const POLL_MS = 4_000;

const STEPS = [
  "ดาวน์โหลดและติดตั้ง Agent จากปุ่มด้านบน",
  "กด “เชื่อมต่อ Agent บนเครื่องนี้” แล้วอนุญาตเมื่อเบราว์เซอร์ถาม",
  "กรอก IP / พอร์ต / รหัสผ่าน JHCIS ในหน้าต่าง Agent แล้วกดทดสอบ",
  "Agent จะอ่าน office.offid และเชื่อมได้ต่อเมื่อตรงกับรหัสสถานบริการนี้",
];

export function EnrollmentPanel({
  installer,
  installationCount,
}: {
  installer: { url: string; version: string };
  installationCount: number;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const countAtLaunch = useRef(installationCount);

  /**
   * Hands the link to the tray instead of leaving it on screen to be clicked.
   *
   * An anchor click is used rather than assigning location.href: the browser
   * treats it as a user-initiated navigation to the custom scheme, which is
   * what keeps this page in place while Windows hands the URL to the agent.
   * The browser still asks for permission the first time, which is the point —
   * a page must not be able to launch a local program unannounced.
   */
  const openAgent = useCallback((protocolUrl: string) => {
    const anchor = document.createElement("a");
    anchor.href = protocolUrl;
    anchor.rel = "noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  // The agent registers itself over its own connection, so the only way this
  // page learns about it is by looking again.
  useEffect(() => {
    if (!waiting) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > WAIT_MS) {
        setWaiting(false);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  useEffect(() => {
    if (waiting && installationCount > countAtLaunch.current) {
      setWaiting(false);
      setEnrollment(null);
      push("ok", "Agent ลงทะเบียนเรียบร้อยแล้ว");
    }
  }, [installationCount, waiting, push]);

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
      countAtLaunch.current = installationCount;
      openAgent(result.protocolUrl);
      setWaiting(true);
      push("ok", "ส่งลิงก์ไปยัง Agent บนเครื่องนี้แล้ว");
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
    <Card>
      <CardHeader
        icon={<IconPlug size={16} />}
        title="ลงทะเบียน Agent ที่เครื่องในสถานบริการ"
        description="ติดตั้ง Agent บนเครื่องที่อยู่ในวง LAN เดียวกับ JHCIS แล้วเปิดลิงก์ลงทะเบียนบนเครื่องนั้น รหัสฐานข้อมูล JHCIS กรอกที่เครื่องเท่านั้น ไม่ถูกส่งขึ้นระบบกลาง"
        actions={
          installer.url ? (
            <ExternalButtonLink href={installer.url} variant="outline" icon={<IconDownload size={15} />}>
              ดาวน์โหลดตัวติดตั้ง{installer.version ? ` ${installer.version}` : ""}
            </ExternalButtonLink>
          ) : null
        }
      />

      <CardBody className="space-y-3.5">
        {installer.url ? null : (
          <Alert tone="warning" title="ยังไม่มีลิงก์ตัวติดตั้ง">
            ผู้ดูแลระบบส่วนกลางตั้งค่าได้ที่หน้า “จัดการระบบ” หัวข้อ “ตัวติดตั้ง Agent”
          </Alert>
        )}

        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-2 rounded-lg bg-surface-subtle p-2.5">
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full bg-primary-100 text-xxs font-bold text-primary-700"
              >
                {index + 1}
              </span>
              <span className="type-help">{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<IconLink size={15} />}
            loading={busy === "enroll" || waiting}
            disabled={busy !== null}
            onClick={() => void createLink()}
          >
            {waiting ? "รอ Agent ตอบกลับ…" : "เชื่อมต่อ Agent บนเครื่องนี้"}
          </Button>
          <Button loading={busy === "test_connection"} disabled={busy !== null} onClick={() => void sendCommand("test_connection")}>
            ทดสอบการเชื่อมต่อ
          </Button>
          <Button
            icon={<IconRefresh size={15} />}
            loading={busy === "sync_now"}
            disabled={busy !== null}
            onClick={() => void sendCommand("sync_now")}
          >
            ดึงรายการยาตอนนี้
          </Button>
        </div>

        {enrollment ? (
          <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
            <p className="text-xxs font-semibold text-primary-700">
              {waiting
                ? "กำลังรอ Agent บนเครื่องนี้ลงทะเบียน — หากเบราว์เซอร์ถามว่าจะเปิด TMT Drug Master Agent หรือไม่ ให้กดอนุญาต"
                : "ส่งลิงก์ให้ Agent แล้ว"}
            </p>
            <p className="type-help mt-1">
              ลิงก์นี้ใช้ได้ครั้งเดียว หมดอายุ{" "}
              {new Date(enrollment.expiresAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}
            </p>

            <Button
              size="sm"
              className="mt-2.5"
              icon={<IconLink size={13} />}
              onClick={() => {
                openAgent(enrollment.protocolUrl);
                setWaiting(true);
              }}
            >
              เปิด Agent อีกครั้ง
            </Button>

            <p className="type-help mt-3">
              ถ้าไม่มีอะไรเกิดขึ้น แปลว่าเครื่องนี้ยังไม่ได้ติดตั้ง Agent หรือยังไม่ได้เปิดโปรแกรม —
              คัดลอกค่าด้านล่างไปกรอกในหน้าตั้งค่าของ Agent แทนได้
            </p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-3">
              {[
                { label: "Server URL", value: enrollment.serverUrl },
                { label: "รหัสสถานบริการ", value: enrollment.facilityCode },
                { label: "Enrollment token", value: enrollment.enrollmentToken },
              ].map((item) => (
                <div key={item.label} className="min-w-0 rounded-md border border-primary-200 bg-surface p-2">
                  <dt className="type-caption">{item.label}</dt>
                  <dd className="mt-0.5 break-all font-mono text-xxs text-slate-700">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
