"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, SelectInput, TextInput } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StickyHead, Table, TableMessage, TableScroll, TableSkeleton } from "@/components/ui/table";
import { IconCheck, IconClose, IconSearch } from "@/components/ui/icons";

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
 * never reloads the page and never moves the scroll position (docs/SPEC.md).
 *
 * The generic name and strength lead each result rather than the brand: those
 * are what decide whether a pairing is correct, and the brand is what makes two
 * otherwise identical products look different.
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

  const columns = onSelect ? 7 : 6;
  const hasFilters = activeFilters.length > 0;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-end gap-2.5">
        {!lockType ? (
          <Field label="คลัง" htmlFor="standard-type">
            <SelectInput
              id="standard-type"
              className="w-28"
              value={type}
              onChange={(event) => setChosenType(event.target.value === "TTMT" ? "TTMT" : "TMT")}
            >
              <option value="TMT">TMT</option>
              <option value="TTMT">TTMT</option>
            </SelectInput>
          </Field>
        ) : (
          <Badge tone="info" className="mb-2">
            คลัง {type}
          </Badge>
        )}

        {FILTERS.map((filter) => (
          <Field key={filter.key} label={filter.label} htmlFor={`filter-${filter.key}`} className="min-w-36 flex-1">
            <TextInput
              id={`filter-${filter.key}`}
              value={filters[filter.key]}
              autoComplete="off"
              mono={filter.key === "code" || filter.key === "registrationNumber"}
              onChange={(event) => setFilters((current) => ({ ...current, [filter.key]: event.target.value }))}
            />
          </Field>
        ))}

        <Button size="sm" className="mb-1" icon={<IconClose size={13} />} disabled={!hasFilters} onClick={() => setFilters(EMPTY)}>
          ล้างตัวกรอง
        </Button>
      </div>

      <p className="type-caption" role="status" aria-live="polite">
        {status === "idle" && "พิมพ์อย่างน้อย 2 ตัวอักษรในช่องใดช่องหนึ่งเพื่อค้นหา"}
        {status === "short" && "ต้องพิมพ์อย่างน้อย 2 ตัวอักษรในทุกช่องที่กรอก"}
        {status === "loading" && "กำลังค้นหา…"}
        {status === "empty" && "ไม่พบรายการที่ตรงกับตัวกรอง"}
        {status === "error" && "ค้นหาไม่สำเร็จ"}
        {status === "ready" && `พบ ${rows.length.toLocaleString("th-TH")} รายการ (แสดงเฉพาะรายการที่เปิดใช้งาน)`}
      </p>

      {status === "error" ? (
        <div className="rounded-lg border border-border">
          <ErrorState
            compact
            title="ค้นหามาตรฐานไม่สำเร็จ"
            description="ระบบติดต่อคลังมาตรฐานไม่ได้ในขณะนี้ ตัวกรองที่กรอกไว้ยังคงอยู่"
            onRetry={() => void runSearch()}
          />
        </div>
      ) : status === "loading" || rows.length > 0 || status === "empty" ? (
        <TableScroll className="rounded-lg border border-border" maxHeight="24rem">
          <Table>
            <StickyHead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อสามัญ</th>
                <th>ความแรง / รูปแบบ</th>
                <th>ชื่อการค้า</th>
                <th>ผู้ผลิต</th>
                <th>ISED</th>
                {onSelect ? <th className="w-0" /> : null}
              </tr>
            </StickyHead>

            {status === "loading" && rows.length === 0 ? (
              <TableSkeleton rows={5} columns={columns} />
            ) : (
              <tbody>
                {rows.length === 0 ? (
                  <TableMessage colSpan={columns}>
                    <EmptyState
                      compact
                      icon={<IconSearch size={18} />}
                      title="ไม่พบรายการที่ตรงกับตัวกรอง"
                      description="ลองค้นด้วยชื่อสามัญแทนชื่อการค้า หรือลดจำนวนช่องที่กรอกลง"
                    />
                  </TableMessage>
                ) : (
                  rows.map((row) => {
                    const chosen = selectedCode === row.standardCode;
                    return (
                      <tr key={row.standardCode} className={chosen ? "row-selected" : undefined}>
                        <td className="cell-code">{row.standardCode}</td>
                        <td className="max-w-64 font-medium text-ink">{row.activeIngredient ?? "—"}</td>
                        <td>
                          {row.strength ?? "—"}
                          {row.dosageForm ? <div className="type-help">{row.dosageForm}</div> : null}
                        </td>
                        <td className="max-w-48 text-slate-600">{row.tradeName ?? "—"}</td>
                        <td className="max-w-48 font-medium text-ink">{row.manufacturer ?? "—"}</td>
                        <td>{row.exportIsed ?? <Badge tone="warning">ไม่มี</Badge>}</td>
                        {onSelect ? (
                          <td>
                            <Button
                              size="sm"
                              variant={chosen ? "secondary" : "primary"}
                              icon={chosen ? <IconCheck size={13} /> : undefined}
                              onClick={() => onSelect(row)}
                            >
                              {chosen ? "เลือกอยู่" : "เลือก"}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            )}
          </Table>
        </TableScroll>
      ) : null}
    </div>
  );
}
