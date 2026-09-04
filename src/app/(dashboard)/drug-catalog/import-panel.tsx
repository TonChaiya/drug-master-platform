"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FileInput, TextInput } from "@/components/ui/form";
import { IconUpload } from "@/components/ui/icons";

export function CatalogImportPanel() {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setProblems([]);
    try {
      const response = await fetch("/api/v1/drug-catalog/import", { method: "POST", body: new FormData(form) });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        details?: string[];
        rowCount?: number;
        skippedEmptyRows?: number;
        format?: string;
      };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "นำเข้าไม่สำเร็จ");
        setProblems(result.details ?? []);
        return;
      }
      push(
        "ok",
        `นำเข้าสำเร็จ ${result.rowCount?.toLocaleString("th-TH")} แถว (${result.format})` +
          (result.skippedEmptyRows ? ` · ข้ามแถวว่าง ${result.skippedEmptyRows}` : ""),
      );
      form.reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="นำเข้าไฟล์ Drug Catalog ล่าสุด"
        description="ระบบตรวจชนิดไฟล์จากลายเซ็นจริงไม่ใช่นามสกุล และตรวจหัวตาราง 22 คอลัมน์ตามลำดับก่อนรับข้อมูล"
      />
      <CardBody>
        <form className="flex flex-wrap items-end gap-2.5" onSubmit={submit}>
          <Field label="ไฟล์ (.xls / .xlsx)" htmlFor="catalogFile" className="min-w-56 flex-1">
            <FileInput id="catalogFile" name="file" accept=".xls,.xlsx" required />
          </Field>
          <Field label="เวอร์ชัน (ถ้ามี)" htmlFor="sourceVersion">
            <TextInput id="sourceVersion" name="sourceVersion" maxLength={120} className="w-36" />
          </Field>
          <Field label="วันที่ของไฟล์" htmlFor="sourceDate">
            <TextInput id="sourceDate" name="sourceDate" type="date" className="w-40" />
          </Field>
          <Button type="submit" variant="primary" icon={<IconUpload size={15} />} loading={busy}>
            นำเข้า
          </Button>
        </form>

        {problems.length > 0 ? (
          <Alert tone="danger" className="mt-3" title={`ไฟล์ยังนำเข้าไม่ได้ — รายละเอียดที่ต้องแก้ (${problems.length})`}>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {problems.slice(0, 20).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            {problems.length > 20 ? <p className="mt-1 font-medium">และอีก {problems.length - 20} รายการ</p> : null}
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
