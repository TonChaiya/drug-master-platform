"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useToast } from "@/components/toast";

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
    <section className="card card-pad">
      <h2 className="text-sm font-semibold">นำเข้าไฟล์ Drug Catalog ล่าสุด</h2>
      <p className="mt-0.5 text-xxs text-slate-500">
        ระบบตรวจชนิดไฟล์จากลายเซ็นจริง ไม่ใช่นามสกุล และตรวจหัวตาราง 22 คอลัมน์ตามลำดับก่อนรับข้อมูล
        ไฟล์ที่เนื้อหาซ้ำกับที่เคยนำเข้าจะถูกปฏิเสธ
      </p>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit}>
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="catalogFile">ไฟล์ (.xls / .xlsx)</label>
          <input className="field" id="catalogFile" name="file" type="file" accept=".xls,.xlsx" required />
        </div>
        <div>
          <label className="label" htmlFor="sourceVersion">เวอร์ชัน (ถ้ามี)</label>
          <input className="field w-36" id="sourceVersion" name="sourceVersion" maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="sourceDate">วันที่ของไฟล์</label>
          <input className="field" id="sourceDate" name="sourceDate" type="date" />
        </div>
        <button className="btn-primary btn-sm" disabled={busy}>
          {busy ? "กำลังนำเข้า…" : "นำเข้า"}
        </button>
      </form>

      {problems.length > 0 ? (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger-soft p-2.5">
          <h3 className="text-xxs font-semibold text-danger">รายละเอียดที่ต้องแก้ ({problems.length})</h3>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xxs text-danger">
            {problems.slice(0, 20).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
