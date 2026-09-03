"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { StandardSearch, type StandardRow } from "@/components/standard-search";

interface WorklistRow {
  sourceDrugId: string;
  drugcode: string;
  drugname: string | null;
  drugnamethai: string | null;
  druggenericname: string | null;
  drugtype: string;
  pack: string | null;
  sell: string | null;
  mappingId: string | null;
  standardCode: string | null;
  standardType: string | null;
  tradeName: string | null;
  activeIngredient: string | null;
  manufacturer: string | null;
  strength: string | null;
  dosageForm: string | null;
  updateFlag: string | null;
  mappingSource: string | null;
}

interface Worklist {
  rows: WorklistRow[];
  total: number;
  page: number;
  pageCount: number;
}

const EMPTY: Worklist = { rows: [], total: 0, page: 1, pageCount: 1 };

export function MappingWorkbench({ hasCatalog }: { hasCatalog: boolean }) {
  const { push } = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "mapped">("pending");
  const [drugType, setDrugType] = useState<"all" | "01" | "10">("all");
  const [page, setPage] = useState(1);
  const [worklist, setWorklist] = useState<Worklist>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<WorklistRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const chooserRef = useRef<HTMLDivElement | null>(null);

  // Opening the chooser under a row near the fold would otherwise leave it
  // half off screen; "nearest" scrolls only when it actually has to.
  useEffect(() => {
    chooserRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    const params = new URLSearchParams({ status, drugType, page: String(page), pageSize: "30" });
    if (query.trim().length >= 2) params.set("query", query.trim());
    try {
      const response = await fetch(`/api/v1/mappings/search?${params.toString()}`);
      if (requestIdRef.current !== requestId) return;
      const result = (await response.json()) as { ok?: boolean } & Partial<Worklist>;
      if (!response.ok || !result.ok) {
        push("error", "โหลดรายการยาไม่สำเร็จ");
        return;
      }
      setWorklist({ rows: result.rows ?? [], total: result.total ?? 0, page: result.page ?? 1, pageCount: result.pageCount ?? 1 });
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [drugType, page, push, query, status]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function reconcile() {
    setBusy("reconcile");
    try {
      const response = await fetch("/api/v1/mappings/reconcile", { method: "POST" });
      const result = (await response.json()) as { ok?: boolean; message?: string; created?: number; skippedNoStandard?: number; skippedTypeMismatch?: number };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "จับคู่อัตโนมัติไม่สำเร็จ");
        return;
      }
      push(
        "ok",
        `จับคู่อัตโนมัติ ${result.created?.toLocaleString("th-TH")} รายการ · ` +
          `ไม่พบมาตรฐาน ${result.skippedNoStandard?.toLocaleString("th-TH")} · ชนิดไม่ตรง ${result.skippedTypeMismatch?.toLocaleString("th-TH")}`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function saveMapping(row: WorklistRow, standard: StandardRow) {
    setBusy(row.sourceDrugId);
    try {
      const response = await fetch("/api/v1/mappings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceDrugId: row.sourceDrugId, standardCode: standard.standardCode }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; updateFlag?: string };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "บันทึกไม่สำเร็จ");
        return;
      }
      push("ok", `จับคู่ ${row.drugcode} → ${standard.standardCode} แล้ว (UPDATEFLAG ${result.updateFlag}) พร้อมส่งออกทันที`);
      setSelected(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <section className="card card-pad">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="worklist-query">ค้นหารายการยา (รหัส / ชื่อ)</label>
            <input
              id="worklist-query"
              className="field"
              value={query}
              autoComplete="off"
              onChange={(event) => {
                setPage(1);
                setQuery(event.target.value);
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="worklist-status">สถานะ</label>
            <select
              id="worklist-status"
              className="field w-32"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as typeof status);
              }}
            >
              <option value="pending">คงค้าง</option>
              <option value="mapped">จับคู่แล้ว</option>
              <option value="all">ทั้งหมด</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="worklist-type">ประเภท</label>
            <select
              id="worklist-type"
              className="field w-28"
              value={drugType}
              onChange={(event) => {
                setPage(1);
                setDrugType(event.target.value as typeof drugType);
              }}
            >
              <option value="all">ทั้งหมด</option>
              <option value="01">01 (TMT)</option>
              <option value="10">10 (TTMT)</option>
            </select>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm mb-0.5"
            onClick={() => {
              setQuery("");
              setStatus("pending");
              setDrugType("all");
              setPage(1);
            }}
          >
            ล้างตัวกรอง
          </button>
          <button type="button" className="btn-primary btn-sm mb-0.5" disabled={!hasCatalog || busy !== null} onClick={() => void reconcile()}>
            {busy === "reconcile" ? "กำลังจับคู่…" : "จับคู่อัตโนมัติจาก Drug Catalog"}
          </button>
        </div>
        {!hasCatalog ? (
          <p className="mt-2 text-xxs text-warn">ยังไม่มีไฟล์ Drug Catalog สำหรับสถานบริการนี้ จึงยังจับคู่อัตโนมัติไม่ได้</p>
        ) : null}
      </section>

      <section className="card card-pad">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">รายการยาจาก JHCIS</h2>
          <p className="text-xxs text-slate-500" role="status" aria-live="polite">
            {loading ? "กำลังโหลด…" : `${worklist.total.toLocaleString("th-TH")} รายการ · หน้า ${worklist.page}/${worklist.pageCount}`}
          </p>
        </div>

        {worklist.rows.length === 0 && !loading ? (
          <p className="text-xxs text-slate-500">ไม่พบรายการตามตัวกรองนี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>รหัสยา JHCIS</th>
                  <th>ชื่อยาใน JHCIS</th>
                  <th>ชนิด</th>
                  <th>จับคู่กับมาตรฐาน (จาก TMT API)</th>
                  <th>FLAG</th>
                  <th>ที่มา</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {worklist.rows.map((row) => (
                  <Fragment key={row.sourceDrugId}>
                    <tr className={selected?.sourceDrugId === row.sourceDrugId ? "bg-brand-50" : undefined}>
                    <td className="font-mono">{row.drugcode}</td>
                    <td className="max-w-56">
                      <div className="font-medium">{row.drugname ?? row.drugnamethai ?? "—"}</div>
                      {row.druggenericname ? <div className="text-xxs text-slate-500">{row.druggenericname}</div> : null}
                    </td>
                    <td>
                      <span className="badge-muted">{row.drugtype === "10" ? "10 · TTMT" : "01 · TMT"}</span>
                    </td>
                    {/* Both sides of the pairing, so it can be judged by reading
                        across the row instead of opening each one. */}
                    <td className="max-w-80">
                      {row.standardCode ? (
                        <div className="border-l-2 border-brand-200 pl-2">
                          <div className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="font-mono text-xxs text-slate-500">{row.standardCode}</span>
                            <span className="font-medium">{row.tradeName ?? "—"}</span>
                          </div>
                          <div className="text-xxs text-slate-600">
                            {row.activeIngredient ?? "—"}
                            {row.strength ? <span className="text-slate-500"> · {row.strength}</span> : null}
                          </div>
                          {row.dosageForm || row.manufacturer ? (
                            <div className="text-xxs text-slate-400">
                              {[row.dosageForm, row.manufacturer].filter(Boolean).join(" · ")}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="badge-danger">ยังไม่จับคู่</span>
                      )}
                    </td>
                    <td>{row.updateFlag ? <span className="badge-muted">{row.updateFlag}</span> : "—"}</td>
                    <td className="text-xxs text-slate-500">{row.mappingSource ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busy !== null}
                        onClick={() => setSelected(selected?.sourceDrugId === row.sourceDrugId ? null : row)}
                      >
                        {selected?.sourceDrugId === row.sourceDrugId ? "ปิด" : row.standardCode ? "แก้ไข" : "จับคู่"}
                      </button>
                    </td>
                    </tr>

                    {selected?.sourceDrugId === row.sourceDrugId ? (
                      <tr key={`${row.sourceDrugId}-chooser`} className="bg-brand-50/40">
                        <td colSpan={7} className="p-0">
                          <div ref={chooserRef} className="border-y-2 border-brand-600 bg-white p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="text-sm font-semibold">
                                เลือกมาตรฐานให้ <span className="font-mono">{row.drugcode}</span> —{" "}
                                {row.drugname ?? row.drugnamethai ?? ""}
                              </h3>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => setSelected(null)}>
                                ปิด
                              </button>
                            </div>
                            <p className="mt-0.5 text-xxs text-slate-500">
                              drugtype {row.drugtype} ใช้คลัง {row.drugtype === "10" ? "TTMT" : "TMT"} เท่านั้น
                              และเลือกได้เฉพาะรายการที่เปิดใช้งาน รหัส TMT เดิมใน JHCIS ไม่ถูกใช้เป็นคำตอบโดยตรง
                            </p>
                            <div className="mt-2">
                              <StandardSearch
                                standardType={row.drugtype === "10" ? "TTMT" : "TMT"}
                                lockType
                                selectedCode={row.standardCode}
                                onSelect={(standard) => void saveMapping(row, standard)}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {worklist.pageCount > 1 ? (
          <div className="mt-2 flex items-center gap-1.5">
            <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              ← ก่อนหน้า
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={page >= worklist.pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              ถัดไป →
            </button>
          </div>
        ) : null}
      </section>

    </div>
  );
}
