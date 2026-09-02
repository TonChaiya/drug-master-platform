"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface StandardRow {
  standardCode: string;
  standardType: string;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  dispensingUnit: string | null;
  tradeName: string | null;
  manufacturer: string | null;
  registrationNumber: string | null;
  exportIsed: string | null;
  fsn: string | null;
}

const FILTERS = [
  { key: "code", label: "รหัส TMT/TTMT" },
  { key: "tradeName", label: "ชื่อการค้า" },
  { key: "genericName", label: "ชื่อสามัญ" },
  { key: "manufacturer", label: "ผู้ผลิต" },
  { key: "registrationNumber", label: "เลขทะเบียนยา" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];
type FilterState = Record<FilterKey, string>;

const EMPTY: FilterState = { code: "", tradeName: "", genericName: "", manufacturer: "", registrationNumber: "" };

export interface StandardSearchProps {
  standardType?: "TMT" | "TTMT";
  lockType?: boolean;
  onSelect?: (row: StandardRow) => void;
  selectedCode?: string | null;
}

/**
 * Five independent filters, debounced, with stale responses discarded. Clearing
 * never reloads the page and never moves the scroll position
 * (docs/SPEC.md).
 */
export function StandardSearch({ standardType = "TMT", lockType = false, onSelect, selectedCode }: StandardSearchProps) {
  // Locked mode has no local type: derive it from the prop instead of mirroring
  // it into state (a mirror needs an effect, and the effect is the bug).
  const [chosenType, setChosenType] = useState<"TMT" | "TTMT">(standardType);
  const type = lockType ? standardType : chosenType;
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [rows, setRows] = useState<StandardRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "short" | "empty" | "ready" | "error">("idle");
  const requestIdRef = useRef(0);

  const activeFilters = useMemo(
    () => FILTERS.map((filter) => filters[filter.key].trim()).filter((value) => value.length > 0),
    [filters],
  );

  const runSearch = useCallback(async () => {
    if (activeFilters.length === 0) {
      setRows([]);
      setStatus("idle");
      return;
    }
    if (activeFilters.some((value) => value.length < 2)) {
      setRows([]);
      setStatus("short");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus("loading");

    const params = new URLSearchParams({ standardType: type });
    for (const filter of FILTERS) {
      const value = filters[filter.key].trim();
      if (value) params.set(filter.key, value);
    }

    try {
      const response = await fetch(`/api/v1/standards/search?${params.toString()}`);
      // A slower earlier request must never overwrite a newer result.
      if (requestIdRef.current !== requestId) return;
      const result = (await response.json()) as { ok?: boolean; rows?: StandardRow[] };
      if (!response.ok || !result.ok) {
        setStatus("error");
        return;
      }
      setRows(result.rows ?? []);
      setStatus((result.rows ?? []).length === 0 ? "empty" : "ready");
    } catch {
      if (requestIdRef.current === requestId) setStatus("error");
    }
  }, [activeFilters, filters, type]);

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(), 300);
    return () => clearTimeout(timer);
  }, [runSearch]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {!lockType ? (
          <div>
            <label className="label" htmlFor="standard-type">คลัง</label>
            <select
              id="standard-type"
              className="field w-28"
              value={type}
              onChange={(event) => setChosenType(event.target.value === "TTMT" ? "TTMT" : "TMT")}
            >
              <option value="TMT">TMT</option>
              <option value="TTMT">TTMT</option>
            </select>
          </div>
        ) : (
          <span className="badge-muted mb-1.5">คลัง {type}</span>
        )}

        {FILTERS.map((filter) => (
          <div key={filter.key} className="min-w-36 flex-1">
            <label className="label" htmlFor={`filter-${filter.key}`}>{filter.label}</label>
            <input
              id={`filter-${filter.key}`}
              className="field"
              value={filters[filter.key]}
              autoComplete="off"
              onChange={(event) => setFilters((current) => ({ ...current, [filter.key]: event.target.value }))}
            />
          </div>
        ))}

        <button type="button" className="btn-secondary btn-sm mb-0.5" onClick={() => setFilters(EMPTY)}>
          ล้างตัวกรอง
        </button>
      </div>

      <p className="text-xxs text-slate-500" role="status" aria-live="polite">
        {status === "idle" && "พิมพ์อย่างน้อย 2 ตัวอักษรในช่องใดช่องหนึ่งเพื่อค้นหา"}
        {status === "short" && "ต้องพิมพ์อย่างน้อย 2 ตัวอักษรในทุกช่องที่กรอก"}
        {status === "loading" && "กำลังค้นหา…"}
        {status === "empty" && "ไม่พบรายการที่ตรงกับตัวกรอง"}
        {status === "error" && "ค้นหาไม่สำเร็จ กรุณาลองใหม่"}
        {status === "ready" && `พบ ${rows.length.toLocaleString("th-TH")} รายการ (แสดงเฉพาะรายการที่เปิดใช้งาน)`}
      </p>

      {rows.length > 0 ? (
        <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
          <table className="data-table">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th>รหัส</th>
                <th>ชื่อการค้า</th>
                <th>ชื่อสามัญ</th>
                <th>ความแรง / รูปแบบ</th>
                <th>ผู้ผลิต</th>
                <th>ISED</th>
                {onSelect ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.standardCode} className={selectedCode === row.standardCode ? "bg-brand-50" : undefined}>
                  <td className="font-mono">{row.standardCode}</td>
                  <td>{row.tradeName ?? "—"}</td>
                  <td className="max-w-64">{row.activeIngredient ?? "—"}</td>
                  <td>
                    {row.strength ?? "—"}
                    <div className="text-xxs text-slate-400">{row.dosageForm ?? ""}</div>
                  </td>
                  <td className="max-w-48">{row.manufacturer ?? "—"}</td>
                  <td>{row.exportIsed ?? <span className="badge-warn">ไม่มี</span>}</td>
                  {onSelect ? (
                    <td>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => onSelect(row)}>
                        เลือก
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
