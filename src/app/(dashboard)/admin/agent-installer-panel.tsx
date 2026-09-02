"use client";

import { type FormEvent, useState } from "react";
import type { InstallerLink } from "@/modules/agent/installer-link";

const SOURCE_LABEL: Record<InstallerLink["source"], string> = {
  database: "ตั้งค่าในระบบ",
  environment: "มาจากตัวแปรแวดล้อม NEXT_PUBLIC_AGENT_INSTALLER_URL",
  none: "ยังไม่ได้ตั้งค่า",
};

/**
 * The download link the JHCIS page offers to every facility. Kept here rather
 * than in an env var so publishing a new build does not need a redeploy.
 */
export function AgentInstallerPanel({ initial }: { initial: InstallerLink }) {
  const [link, setLink] = useState(initial);
  const [url, setUrl] = useState(initial.url);
  const [version, setVersion] = useState(initial.version);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(method: "PUT" | "DELETE", body?: unknown) {
    const response = await fetch("/api/v1/admin/agent-installer", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await response.json()) as { ok?: boolean; message?: string; link?: InstallerLink };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setMessage(null);
    try {
      const result = await call("PUT", { url, version });
      if (!result.ok || !result.link) {
        setMessage({ ok: false, text: result.message ?? "บันทึกไม่สำเร็จ" });
        return;
      }
      setLink(result.link);
      setUrl(result.link.url);
      setMessage({
        ok: true,
        text:
          result.link.url === url
            ? "บันทึกลิงก์แล้ว"
            : `บันทึกแล้ว และแปลงลิงก์ Google Drive เป็นแบบดาวน์โหลดตรงให้: ${result.link.url}`,
      });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setMessage(null);
    try {
      const result = await call("DELETE");
      if (result.link) {
        setLink(result.link);
        setUrl(result.link.url);
      }
      setMessage({ ok: true, text: "ลบลิงก์ที่ตั้งไว้แล้ว" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2.5">
      <p className="text-xxs text-slate-500">
        ลิงก์นี้จะกลายเป็นปุ่ม <strong>ดาวน์โหลดตัวติดตั้ง Agent</strong> ในหน้า “เชื่อมต่อ JHCIS” ของทุกสถานบริการ
        วางลิงก์แชร์ของ Google Drive ได้เลย ระบบจะแปลงเป็นแบบดาวน์โหลดตรงให้เอง
      </p>

      <p className="flex flex-wrap items-center gap-1.5 text-xxs">
        <span className={link.url ? "badge-ok" : "badge-warn"}>{link.url ? "พร้อมให้ดาวน์โหลด" : "ยังไม่มีลิงก์"}</span>
        <span className="badge-muted">{SOURCE_LABEL[link.source]}</span>
        {link.updatedAt ? <span className="text-slate-500">แก้ไขล่าสุด {new Date(link.updatedAt).toLocaleString("th-TH")}</span> : null}
      </p>

      <div className="grid gap-2.5 sm:grid-cols-[1fr_8rem]">
        <div>
          <label className="label" htmlFor="installer-url">ลิงก์ไฟล์ติดตั้ง (HTTPS)</label>
          <input
            className="field font-mono"
            id="installer-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://drive.google.com/file/d/…/view"
            required
            maxLength={500}
            inputMode="url"
          />
        </div>
        <div>
          <label className="label" htmlFor="installer-version">เวอร์ชัน</label>
          <input
            className="field font-mono"
            id="installer-version"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="1.0.0"
            maxLength={32}
          />
        </div>
      </div>

      <p className="rounded-md bg-warn-soft px-2.5 py-2 text-xxs text-warn">
        Google Drive ยังขึ้นหน้าเตือน “ไม่สามารถสแกนไวรัสได้” สำหรับไฟล์ใหญ่กว่า ~25 MB และตัวติดตั้งใหญ่กว่านั้น
        ผู้ใช้จะต้องกดยืนยันอีกครั้ง หากต้องการให้กดครั้งเดียวจบ ให้ฝากไฟล์เป็น asset ของ GitHub Release แทน
      </p>

      {message ? (
        <p className={`rounded-md px-2.5 py-2 text-xxs ${message.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`} role="status">
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" disabled={busy !== null}>
          {busy === "save" ? "กำลังบันทึก…" : "บันทึกลิงก์"}
        </button>
        {link.url ? (
          <a className="btn-secondary btn-sm" href={link.url} target="_blank" rel="noreferrer noopener">
            ทดลองเปิดลิงก์
          </a>
        ) : null}
        {link.source === "database" ? (
          <button type="button" className="btn-danger btn-sm ml-auto" disabled={busy !== null} onClick={() => void clear()}>
            {busy === "clear" ? "กำลังลบ…" : "ลบลิงก์"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
