"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/toast";

type Selection = "all-mapped" | "manual-changes";

interface PreviewRow {
  hospdrugcode: string;
  productcat: string;
  tmtid: string;
  genericname: string;
  tradename: string;
  ised: string;
  updateflag: string;
  ndc24: string;
  unitprice: string;
  dateeffective: string | null;
}

export function ExportPanel() {
  const { push } = useToast();
  const [selection, setSelection] = useState<Selection>("all-mapped");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const loadPreview = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/exports/preview?selection=${selection}&limit=100`);
      const result = (await response.json()) as { ok?: boolean; message?: string; total?: number; rows?: PreviewRow[] };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "โหลดตัวอย่างไม่สำเร็จ");
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(result.rows ?? []);
      setTotal(result.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [push, selection]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  async function download() {
    setDownloading(true);
    try {
      const response = await fetch("/api/v1/exports/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        push("error", result.message ?? "สร้างไฟล์ไม่สำเร็จ");
        return;
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "drugcat.xls";
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      push("ok", `ดาวน์โหลด ${filename} (${response.headers.get("X-Export-Row-Count") ?? "?"} แถว)`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="card card-pad">
        <h2 className="text-sm font-semibold">เลือกชุดข้อมูลที่จะส่งออก</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {(
            [
              { value: "all-mapped", label: "ทั้งหมดที่ map แล้ว" },
              { value: "manual-changes", label: "เฉพาะที่ผู้ใช้ map ใหม่/แก้ไข" },
            ] as const
          ).map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="selection"
                value={option.value}
                checked={selection === option.value}
                onChange={() => {
                  setSelection(option.value);
                  setLoading(true);
                }}
              />
              {option.label}
            </label>
          ))}
          <button type="button" className="btn-primary btn-sm ml-auto" disabled={downloading || loading || total === 0} onClick={() => void download()}>
            {downloading ? "กำลังสร้างไฟล์…" : `ดาวน์โหลด .xls (${total.toLocaleString("th-TH")} แถว)`}
          </button>
        </div>
        <p className="mt-2 text-xxs text-slate-500">
          ไฟล์ใช้แม่แบบหัวตาราง 22 คอลัมน์เดิม รหัสทุกช่องเขียนเป็นข้อความเพื่อไม่ให้เลขศูนย์นำหน้าหาย
          และวันที่เป็นชนิดวันที่จริงรูปแบบ dd/mm/yyyy
        </p>
      </section>

      <section className="card card-pad">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">แถวจริงที่จะถูกเขียนลงไฟล์</h2>
          <p className="text-xxs text-slate-500" role="status" aria-live="polite">
            {loading ? "กำลังโหลด…" : `ทั้งหมด ${total.toLocaleString("th-TH")} แถว · แสดง ${rows.length.toLocaleString("th-TH")} แถวแรก`}
          </p>
        </div>

        {rows.length === 0 && !loading ? (
          <p className="text-xxs text-slate-500">ยังไม่มีรายการในชุดนี้</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-md border border-slate-200">
            <table className="data-table">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>#</th>
                  <th>HOSPDRUGCODE</th>
                  <th>PRODUCTCAT</th>
                  <th>TMTID</th>
                  <th>GENERICNAME</th>
                  <th>TRADENAME</th>
                  <th>UNITPRICE</th>
                  <th>ISED</th>
                  <th>NDC24</th>
                  <th>UPDATEFLAG</th>
                  <th>DATEEFFECTIVE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.hospdrugcode}>
                    <td className="tabular-nums text-slate-400">{index + 1}</td>
                    <td className="font-mono">{row.hospdrugcode}</td>
                    <td>{row.productcat}</td>
                    <td className="font-mono">{row.tmtid}</td>
                    <td className="max-w-64">{row.genericname || <span className="badge-warn">ว่าง</span>}</td>
                    <td>{row.tradename || "—"}</td>
                    <td className="tabular-nums">{row.unitprice || "—"}</td>
                    <td>{row.ised || <span className="badge-warn">ว่าง</span>}</td>
                    <td className="font-mono text-xxs">{row.ndc24 || "—"}</td>
                    <td>{row.updateflag}</td>
                    <td>{row.dateeffective ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
