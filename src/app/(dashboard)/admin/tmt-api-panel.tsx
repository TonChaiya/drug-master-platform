"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/badge";
import { Field, TextInput } from "@/components/ui/form";
import { IconLink, IconTrash } from "@/components/ui/icons";

export interface TmtCredentialStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  baseUrl: string;
  username: string;
  updatedAt: string | null;
}

const SOURCE_LABEL: Record<TmtCredentialStatus["source"], string> = {
  database: "บันทึกในระบบ (เข้ารหัส)",
  environment: "มาจากตัวแปรแวดล้อมของเซิร์ฟเวอร์",
  none: "ยังไม่ได้ตั้งค่า",
};

/**
 * TMT API credential management. The stored password is never sent back to the
 * browser, so the field is always blank and saving requires re-entering it.
 */
export function TmtApiPanel({ initial }: { initial: TmtCredentialStatus }) {
  const [status, setStatus] = useState(initial);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(method: "PUT" | "DELETE", body?: unknown) {
    const response = await fetch("/api/v1/admin/tmt-api", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await response.json()) as { ok?: boolean; message?: string; status?: TmtCredentialStatus };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setMessage(null);
    try {
      const result = await send("PUT", { baseUrl, username, password });
      if (!result.ok || !result.status) {
        setMessage({ ok: false, text: result.message ?? "บันทึกไม่สำเร็จ" });
        return;
      }
      setStatus(result.status);
      setPassword("");
      setMessage({ ok: true, text: "บันทึก credential แล้ว กด “ทดสอบการเชื่อมต่อ” เพื่อยืนยัน" });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/tmt-api", { method: "POST" });
      const body = (await response.json()) as { result?: { ok: boolean; message: string; tmtVersion: string | null; latencyMs: number } };
      const result = body.result;
      if (!result) {
        setMessage({ ok: false, text: "ทดสอบไม่สำเร็จ" });
        return;
      }
      setMessage({
        ok: result.ok,
        text: result.ok ? `${result.message} · TMT version ${result.tmtVersion} · ${result.latencyMs} ms` : result.message,
      });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setMessage(null);
    try {
      const result = await send("DELETE");
      if (result.status) setStatus(result.status);
      setPassword("");
      setMessage({ ok: true, text: "ลบ credential ที่บันทึกไว้แล้ว" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.configured ? "success" : "danger"} dot>
          {status.configured ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า"}
        </Badge>
        <Badge>{SOURCE_LABEL[status.source]}</Badge>
        {status.updatedAt ? (
          <span className="type-caption">แก้ไขล่าสุด {new Date(status.updatedAt).toLocaleString("th-TH")}</span>
        ) : null}
      </div>

      <p className="type-help">
        รหัสผ่านถูกเข้ารหัสก่อนบันทึกและไม่ถูกส่งกลับมาแสดงอีก การเปลี่ยนค่าจึงต้องกรอกรหัสผ่านใหม่ทุกครั้ง
        หากไม่ได้บันทึกไว้ที่นี่ ระบบจะใช้ค่าจากตัวแปรแวดล้อม <code className="font-mono">TMT_API_*</code> แทน
      </p>

      <form onSubmit={save} className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Base URL" htmlFor="tmt-base" className="sm:col-span-2" required>
          <TextInput
            id="tmt-base"
            mono
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
            maxLength={255}
            inputMode="url"
          />
        </Field>
        <Field label="ชื่อผู้ใช้ TMT API" htmlFor="tmt-user" required>
          <TextInput
            id="tmt-user"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            maxLength={160}
            autoComplete="off"
          />
        </Field>
        <Field label="รหัสผ่าน TMT API" htmlFor="tmt-pass" required>
          <TextInput
            id="tmt-pass"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={255}
            autoComplete="new-password"
            placeholder={status.source === "database" ? "กรอกใหม่เพื่อเปลี่ยน" : ""}
          />
        </Field>

        {message ? (
          <Alert tone={message.ok ? "success" : "danger"} className="sm:col-span-2">
            {message.text}
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" size="sm" loading={busy === "save"} disabled={busy !== null}>
            บันทึก credential
          </Button>
          <Button
            size="sm"
            icon={<IconLink size={13} />}
            loading={busy === "test"}
            disabled={busy !== null || !status.configured}
            onClick={() => void test()}
          >
            ทดสอบการเชื่อมต่อ
          </Button>
          {status.source === "database" ? (
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              icon={<IconTrash size={13} />}
              loading={busy === "clear"}
              disabled={busy !== null}
              onClick={() => void clear()}
            >
              ลบค่าที่บันทึกไว้
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
