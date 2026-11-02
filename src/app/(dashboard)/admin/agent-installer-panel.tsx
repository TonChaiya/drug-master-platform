"use client";

import { type FormEvent, useState } from "react";
import type { InstallerLink } from "@/modules/agent/installer-link";
import { Button, ExternalButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/badge";
import { Field, TextInput } from "@/components/ui/form";
import { IconExternal, IconTrash } from "@/components/ui/icons";

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
  const [editing, setEditing] = useState(false);
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
      setVersion(result.link.version);
      setEditing(false);
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
        setVersion(result.link.version);
      }
      setEditing(false);
      setMessage({ ok: true, text: "ลบลิงก์ที่ตั้งไว้แล้ว" });
    } finally {
      setBusy(null);
    }
  }

  const host = (() => {
    if (!link.url) return "—";
    try {
      return new URL(link.url).hostname;
    } catch {
      return "ลิงก์ที่ตั้งไว้";
    }
  })();

  function openEditor() {
    setUrl(link.url);
    setVersion(link.version);
    setMessage(null);
    setEditing(true);
  }

  function closeEditor() {
    setUrl(link.url);
    setVersion(link.version);
    setMessage(null);
    setEditing(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={link.url ? "success" : "warning"} dot>
          {link.url ? "พร้อมให้ดาวน์โหลด" : "ยังไม่มีลิงก์"}
        </Badge>
        <Badge>{SOURCE_LABEL[link.source]}</Badge>
        {link.updatedAt ? <span className="type-caption">แก้ไขล่าสุด {new Date(link.updatedAt).toLocaleString("th-TH")}</span> : null}
      </div>

      {!editing ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xxs">
            <dt className="text-slate-500">เวอร์ชัน</dt>
            <dd className="font-mono font-medium text-slate-800">{link.version || "—"}</dd>
            <dt className="text-slate-500">แหล่งไฟล์</dt>
            <dd className="truncate font-medium text-slate-800" title={link.url}>{host}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={openEditor}>แก้ไข</Button>
            {link.url ? (
              <ExternalButtonLink href={link.url} size="sm" icon={<IconExternal size={13} />}>
                ทดสอบลิงก์
              </ExternalButtonLink>
            ) : null}
          </div>
        </>
      ) : (
        <form onSubmit={save} className="space-y-3 border-t border-border pt-3">
          <p className="type-help text-slate-600">วางลิงก์แชร์ของ Google Drive ได้ ระบบจะแปลงเป็นแบบดาวน์โหลดตรงให้เอง</p>

          <div className="grid gap-2.5 sm:grid-cols-[1fr_8rem]">
            <Field label="ลิงก์ไฟล์ติดตั้ง (HTTPS)" htmlFor="installer-url" required>
              <TextInput
                id="installer-url"
                mono
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://drive.google.com/file/d/…/view"
                required
                maxLength={500}
                inputMode="url"
              />
            </Field>
            <Field label="เวอร์ชัน" htmlFor="installer-version">
              <TextInput
                id="installer-version"
                mono
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="1.2.1"
                maxLength={32}
              />
            </Field>
          </div>

          <Alert tone="warning" title="ไฟล์ใหญ่กว่า ~25 MB บน Google Drive จะขึ้นหน้าเตือนก่อนดาวน์โหลด">
            หากต้องการให้กดครั้งเดียวจบ ให้ฝากไฟล์เป็น asset ของ GitHub Release แทน
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy === "save"} disabled={busy !== null}>
              บันทึกลิงก์
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={closeEditor}>ยกเลิก</Button>
            {link.source === "database" ? (
              <Button
                size="sm"
                variant="danger"
                className="ml-auto"
                icon={<IconTrash size={13} />}
                loading={busy === "clear"}
                disabled={busy !== null}
                onClick={() => void clear()}
              >
                ลบลิงก์
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {message ? <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert> : null}
    </div>
  );
}
