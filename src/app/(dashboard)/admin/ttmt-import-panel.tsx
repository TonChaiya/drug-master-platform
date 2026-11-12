"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FileInput, TextInput } from "@/components/ui/form";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { type TtmtOperationImport } from "@/modules/tmt/operations";

function stamp(value: string | null): string {
  return value ? new Date(value).toLocaleString("th-TH") : "—";
}

export function TtmtImportPanel({ imports }: { imports: TtmtOperationImport[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; details: string[] } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/v1/admin/ttmt-import", { method: "POST", body: new FormData(form) });
      const body = (await response.json()) as { ok?: boolean; message?: string; rowCount?: number; warnings?: string[]; details?: string[] };
      if (!response.ok || !body.ok) {
        setMessage({ ok: false, text: body.message ?? "นำเข้าไฟล์ไม่สำเร็จ", details: body.details ?? [] });
        return;
      }
      setMessage({ ok: true, text: `นำเข้า MasterTTMT สำเร็จ ${body.rowCount?.toLocaleString("th-TH")} รายการ`, details: body.warnings ?? [] });
      form.reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-3">
    <form className="flex flex-wrap items-end gap-2.5" onSubmit={submit}>
      <Field label="เวอร์ชันข้อมูล TTMT" htmlFor="admin-ttmt-version" required><TextInput id="admin-ttmt-version" name="version" required maxLength={120} mono placeholder="20261001" className="w-40" /></Field>
      <Field label="ไฟล์ MasterTTMT (.xls / .xlsx)" htmlFor="admin-ttmt-file" required className="min-w-52 flex-1"><FileInput id="admin-ttmt-file" name="file" accept=".xls,.xlsx" required /></Field>
      <Button type="submit" variant="primary" loading={busy}>นำเข้า</Button>
    </form>
    {message ? <Alert tone={message.ok ? "success" : "danger"} title={message.text}>{message.details.length > 0 ? <ul className="mt-1 list-inside list-disc">{message.details.slice(0, 10).map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}</Alert> : null}
    <TableScroll maxHeight="16rem"><Table><thead><tr><th>เวอร์ชันข้อมูล TTMT</th><th>สถานะ</th><th>แถว</th><th>เริ่ม</th><th>เสร็จ</th></tr></thead><tbody>
      {imports.length === 0 ? <TableMessage colSpan={5}>ยังไม่มีประวัตินำเข้า TTMT</TableMessage> : imports.map((item) => <tr key={item.id}><td className="cell-code">{item.version}</td><td><StatusBadge status={item.status} /></td><td className="cell-num">{item.rowCount.toLocaleString("th-TH")}</td><td>{stamp(item.startedAt)}</td><td>{stamp(item.completedAt)}</td></tr>)}
    </tbody></Table></TableScroll>
  </div>;
}
