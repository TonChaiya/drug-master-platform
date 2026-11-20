"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { EMPTY_STANDARD_FILTERS, StandardFilterInputs, standardFilterValues, type StandardFilterState } from "@/components/standard-search";
import { TmtResultCard } from "@/components/tmt/tmt-result-card";
import { TtmtResultCard, type TtmtResult } from "@/components/ttmt/ttmt-result-card";
import { Alert, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FilterBar, SearchInput, SelectInput } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Pagination, Table, TableMessage, TableScroll, TableSkeleton } from "@/components/ui/table";
import { IconClose, IconLink, IconPill, IconRefresh, IconSearch } from "@/components/ui/icons";
import type { TmtConceptDetail } from "@/modules/tmt/detail";
import type { TmtSearchResult } from "@/modules/tmt/browser";
import type { V2WorklistRow } from "@/modules/mappings/v2-worklist";

type Worklist = { rows: V2WorklistRow[]; total: number; page: number; pageSize: number; pageCount: number };
type LifecycleFilter = "all" | "pending" | "needs_review" | "mapped";
type DrugTypeFilter = "all" | "01" | "10";
type StandardSearchStatus = "idle" | "short" | "loading" | "empty" | "ready" | "error";
const EMPTY: Worklist = { rows: [], total: 0, page: 1, pageSize: 30, pageCount: 1 };
const COLUMNS = 8;

export function mappingStandardSearchUrl(source: "TMT" | "TTMT", filters: StandardFilterState): string {
  const params = new URLSearchParams();
  if (source === "TMT") {
    if (filters.code.trim()) params.set("q", filters.code.trim());
    if (filters.registrationNumber.trim()) params.set("registration", filters.registrationNumber.trim());
  } else {
    params.set("source", "TTMT");
    if (filters.code.trim()) params.set("code", filters.code.trim());
    if (filters.registrationNumber.trim()) params.set("registrationNumber", filters.registrationNumber.trim());
  }
  for (const key of ["tradeName", "genericName", "manufacturer"] as const) {
    if (filters[key].trim()) params.set(key, filters[key].trim());
  }
  if (source === "TMT") params.set("limit", "30");
  return `${source === "TMT" ? "/api/v1/tmt-v2/search" : "/api/v1/mappings/v2/standards"}?${params.toString()}`;
}

function statusLabel(status: V2WorklistRow["status"]): string {
  return status === "needs_review" ? "ต้องตรวจสอบ" : status === "mapped" ? "จับคู่แล้ว" : "คงค้าง";
}
function statusTone(status: V2WorklistRow["status"]): "warning" | "success" | "neutral" {
  return status === "needs_review" ? "warning" : status === "mapped" ? "success" : "neutral";
}

function mappingSourceLabel(source: string | null): string | null {
  if (source === "manual") return "ผู้ใช้จับคู่";
  if (source === "drug_catalog") return "Drug Catalog";
  return source;
}

export function MappedStandardSummary({ row }: { row: V2WorklistRow }) {
  if (!row.standardCode) return <Badge tone="warning" dot>ยังไม่จับคู่</Badge>;
  const primaryName = row.standardActiveIngredient ?? row.standardName;
  const sourceLabel = mappingSourceLabel(row.mappingSource);
  return <>
    <div className="border-l-2 border-primary-200 pl-2.5">
      <div className="cell-code text-xxs text-slate-500">{row.standardCode}</div>
      {primaryName || row.standardStrength ? <div className="font-semibold text-ink">{primaryName ?? "—"}{row.standardStrength ? ` · ${row.standardStrength}` : null}</div> : null}
      {row.standardTradeName ? <div className="type-help">{row.standardTradeName}</div> : null}
      {row.standardDosageForm || row.standardManufacturer ? <div className="type-help">{row.standardDosageForm}{row.standardDosageForm && row.standardManufacturer ? " · " : null}{row.standardManufacturer ? <span className="font-medium text-ink">{row.standardManufacturer}</span> : null}</div> : null}
    </div>
    {sourceLabel ? <div className="type-caption mt-1">ที่มา: {sourceLabel}</div> : null}
  </>;
}

export function isCurrentCandidate(row: V2WorklistRow, source: "TMT" | "TTMT", code: string, level: string): boolean {
  return row.standardSource === source && row.standardCode === code && row.standardLevel === level;
}

export function MappingComparisonContext({ row }: { row: V2WorklistRow }) {
  return <div className="mt-3 grid gap-2 sm:grid-cols-2">
    <section className="min-w-0 rounded-lg border border-border bg-surface-subtle p-3">
      <div className="type-caption">รายการยา JHCIS</div>
      <div className="mt-1 flex flex-wrap items-center gap-2"><span className="cell-code">{row.drugcode}</span><Badge>{row.drugtype === "10" ? "10 · TTMT" : "01 · TMT"}</Badge></div>
      <div className="mt-1 font-semibold text-ink">{row.drugname ?? row.drugnamethai ?? "—"}</div>
      {row.druggenericname ? <div className="type-help">{row.druggenericname}</div> : null}
    </section>
    <section className="min-w-0 rounded-lg border border-border bg-surface-subtle p-3">
      <div className="type-caption">มาตรฐานที่จับคู่ปัจจุบัน</div>
      {row.standardSource ? <div className="mt-1 flex flex-wrap gap-1"><Badge tone={row.standardSource === "TMT" ? "info" : "success"}>{row.standardSource}</Badge>{row.standardLevel ? <Badge>{row.standardLevel.toUpperCase()}</Badge> : null}</div> : null}
      <div className="mt-1"><MappedStandardSummary row={row} /></div>
    </section>
  </div>;
}

export function V2MappingWorkbench({ reconcileAvailable }: { reconcileAvailable: boolean }) {
  const { push } = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LifecycleFilter>("pending");
  const [drugType, setDrugType] = useState<DrugTypeFilter>("all");
  const [page, setPage] = useState(1);
  const [worklist, setWorklist] = useState<Worklist>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<V2WorklistRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [standardFilters, setStandardFilters] = useState<StandardFilterState>(EMPTY_STANDARD_FILTERS);
  const [standardSearchStatus, setStandardSearchStatus] = useState<StandardSearchStatus>("idle");
  const [tmtRows, setTmtRows] = useState<TmtSearchResult[]>([]);
  const [ttmtRows, setTtmtRows] = useState<TtmtResult[]>([]);
  const [detail, setDetail] = useState<TmtConceptDetail | null>(null);
  const chooserRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const standardRequestIdRef = useRef(0);

  useEffect(() => { chooserRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [selected]);
  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    const params = new URLSearchParams({ status, drugType, page: String(page), pageSize: "30" });
    if (query.trim()) params.set("query", query.trim());
    try {
      const response = await fetch(`/api/v1/mappings/v2/worklist?${params.toString()}`);
      const payload = (await response.json()) as { ok?: boolean; message?: string } & Partial<Worklist>;
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "โหลดรายการยาไม่สำเร็จ");
      if (requestId !== requestIdRef.current) return;
      setFailed(false);
      setWorklist({ rows: payload.rows ?? [], total: payload.total ?? 0, page: payload.page ?? 1, pageSize: payload.pageSize ?? 30, pageCount: payload.pageCount ?? 1 });
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setFailed(true);
        push("error", error instanceof Error ? error.message : "โหลดรายการยาไม่สำเร็จ");
      }
    } finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [drugType, page, push, query, status]);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);

  function openChooser(row: V2WorklistRow) {
    setSelected(selected?.sourceDrugId === row.sourceDrugId ? null : row);
    standardRequestIdRef.current += 1;
    setStandardFilters(EMPTY_STANDARD_FILTERS); setStandardSearchStatus("idle"); setTmtRows([]); setTtmtRows([]); setDetail(null);
  }
  const searchStandards = useCallback(async () => {
    const values = standardFilterValues(standardFilters);
    const requestId = standardRequestIdRef.current + 1;
    standardRequestIdRef.current = requestId;
    if (!selected || values.length === 0) {
      setStandardSearchStatus("idle"); setTmtRows([]); setTtmtRows([]); setDetail(null);
      return;
    }
    if (values.some((value) => value.length < 2)) {
      setStandardSearchStatus("short"); setTmtRows([]); setTtmtRows([]); setDetail(null);
      return;
    }
    const source = selected.drugtype === "10" ? "TTMT" : "TMT";
    setStandardSearchStatus("loading");
    setTmtRows([]); setTtmtRows([]); setDetail(null);
    try {
      const response = await fetch(mappingStandardSearchUrl(source, standardFilters));
      if (source === "TMT") {
        const payload = (await response.json()) as { ok?: boolean; rows?: TmtSearchResult[]; message?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.message ?? "ค้นหา TMT ไม่สำเร็จ");
        if (requestId !== standardRequestIdRef.current) return;
        setTmtRows(payload.rows ?? []); setTtmtRows([]);
        setStandardSearchStatus((payload.rows ?? []).length > 0 ? "ready" : "empty");
      } else {
        const payload = (await response.json()) as { ok?: boolean; rows?: TtmtResult[]; message?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.message ?? "ค้นหา TTMT ไม่สำเร็จ");
        if (requestId !== standardRequestIdRef.current) return;
        setTtmtRows(payload.rows ?? []); setTmtRows([]);
        setStandardSearchStatus((payload.rows ?? []).length > 0 ? "ready" : "empty");
      }
      setDetail(null);
    } catch (error) {
      if (requestId !== standardRequestIdRef.current) return;
      setStandardSearchStatus("error");
      push("error", error instanceof Error ? error.message : "ค้นหามาตรฐานไม่สำเร็จ");
    }
  }, [push, selected, standardFilters]);
  useEffect(() => { const timer = setTimeout(() => void searchStandards(), 300); return () => clearTimeout(timer); }, [searchStandards]);
  function clearStandardFilters() {
    standardRequestIdRef.current += 1;
    setStandardFilters(EMPTY_STANDARD_FILTERS); setStandardSearchStatus("idle"); setTmtRows([]); setTtmtRows([]); setDetail(null);
  }
  async function openDetail(tmtId: string) {
    setBusy("detail");
    try {
      const response = await fetch(`/api/v1/tmt-v2/concepts/${encodeURIComponent(tmtId)}?depth=1&maxNodes=50`);
      const payload = (await response.json()) as { ok?: boolean; detail?: TmtConceptDetail; message?: string };
      if (!response.ok || !payload.ok || !payload.detail) throw new Error(payload.message ?? "โหลดรายละเอียด TMT ไม่สำเร็จ");
      setDetail(payload.detail);
    } catch (error) { push("error", error instanceof Error ? error.message : "โหลดรายละเอียด TMT ไม่สำเร็จ"); }
    finally { setBusy(null); }
  }
  async function save(row: V2WorklistRow, source: "TMT" | "TTMT", code: string, level: string, confirmReview = false) {
    setBusy(row.sourceDrugId);
    try {
      const response = await fetch("/api/v1/mappings/v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceDrugId: row.sourceDrugId, standardSource: source, standardCode: code, standardLevel: level, confirmReview }) });
      const payload = (await response.json()) as { ok?: boolean; message?: string; updateFlag?: string; reviewNoop?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "บันทึกการจับคู่ไม่สำเร็จ");
      push("ok", confirmReview ? (payload.reviewNoop ? "รายการนี้ได้รับการยืนยันไว้แล้ว" : `ตรวจสอบและยืนยัน ${row.drugcode} แล้ว`) : `บันทึก ${row.drugcode} → ${code} แล้ว (UPDATEFLAG ${payload.updateFlag ?? "—"})`);
      setSelected(null); await load();
    } catch (error) { push("error", error instanceof Error ? error.message : "บันทึกการจับคู่ไม่สำเร็จ"); }
    finally { setBusy(null); }
  }
  async function reconcile() {
    setBusy("reconcile");
    try {
      const response = await fetch("/api/v1/mappings/reconcile", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; message?: string; created?: number; updated?: number; needsReview?: number; skippedNoStandard?: number; skippedTypeMismatch?: number };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "จับคู่อัตโนมัติไม่สำเร็จ");
      push("ok", `สร้าง ${payload.created?.toLocaleString("th-TH")} · อัปเดต ${payload.updated?.toLocaleString("th-TH")} · ต้องตรวจสอบ ${payload.needsReview?.toLocaleString("th-TH")} · ไม่พบมาตรฐาน ${payload.skippedNoStandard?.toLocaleString("th-TH")} · ชนิดไม่ตรง ${payload.skippedTypeMismatch?.toLocaleString("th-TH")}`);
      await load();
    } catch (error) { push("error", error instanceof Error ? error.message : "จับคู่อัตโนมัติไม่สำเร็จ"); }
    finally { setBusy(null); }
  }
  function resetFilters() { setQuery(""); setStatus("pending"); setDrugType("all"); setPage(1); }

  const filtered = Boolean(query.trim()) || status !== "pending" || drugType !== "all";
  return <div className="space-y-3.5">
    <Card><CardBody><FilterBar actions={<><Button size="sm" icon={<IconClose size={13} />} disabled={!filtered} onClick={resetFilters}>ล้างตัวกรอง</Button>{reconcileAvailable ? <Button size="sm" variant="primary" icon={<IconRefresh size={13} />} loading={busy === "reconcile"} disabled={busy !== null} onClick={() => void reconcile()}>จับคู่อัตโนมัติจาก Drug Catalog</Button> : <span className="type-help max-w-52">จับคู่อัตโนมัติยังไม่พร้อม — ยังจับคู่ด้วยตนเองได้</span>}</>}>
      <Field label="ค้นหารายการยา" htmlFor="mapping-v2-worklist-query" className="min-w-52 flex-1"><SearchInput id="mapping-v2-worklist-query" placeholder="รหัสยา หรือชื่อยา" value={query} autoComplete="off" onChange={(event) => { setPage(1); setQuery(event.target.value); }} /></Field>
      <Field label="สถานะ" htmlFor="mapping-v2-worklist-status"><SelectInput id="mapping-v2-worklist-status" className="w-32" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as LifecycleFilter); }}><option value="pending">คงค้าง</option><option value="needs_review">ต้องตรวจสอบ</option><option value="mapped">จับคู่แล้ว</option><option value="all">ทั้งหมด</option></SelectInput></Field>
      <Field label="ประเภท" htmlFor="mapping-v2-worklist-type"><SelectInput id="mapping-v2-worklist-type" className="w-32" value={drugType} onChange={(event) => { setPage(1); setDrugType(event.target.value as DrugTypeFilter); }}><option value="all">ทั้งหมด</option><option value="01">01 · TMT</option><option value="10">10 · TTMT</option></SelectInput></Field>
    </FilterBar></CardBody></Card>
    <Card><CardHeader title="รายการยาจาก JHCIS" description="ค้นหา กรอง และจับคู่ด้วยมาตรฐาน TMT/TTMT ตามชนิดยา" actions={<span className="type-caption tabular-nums" role="status" aria-live="polite">{loading ? "กำลังโหลด…" : `${worklist.total.toLocaleString("th-TH")} รายการ`}</span>} /><CardBody flush className="pt-3">
      {failed ? <ErrorState title="โหลดรายการยาไม่สำเร็จ" description="ระบบดึงรายการยาจากฐานข้อมูลไม่ได้ในขณะนี้ ตัวกรองที่เลือกไว้ยังคงอยู่" onRetry={() => void load()} /> : <TableScroll><Table><thead><tr><th>รหัสยา JHCIS</th><th>ชื่อยาใน JHCIS</th><th>ชนิด</th><th>มาตรฐานปัจจุบัน</th><th>แหล่ง / ระดับ</th><th>FLAG</th><th>สถานะ</th><th className="w-0">การทำงาน</th></tr></thead>
        {loading && worklist.rows.length === 0 ? <TableSkeleton rows={8} columns={COLUMNS} /> : <tbody>{worklist.rows.length === 0 ? <TableMessage colSpan={COLUMNS}><EmptyState compact icon={filtered ? <IconSearch size={18} /> : <IconPill size={18} />} title={filtered ? "ไม่พบรายการตามตัวกรองนี้" : "ยังไม่มีรายการยาที่คงค้าง"} description={filtered ? "ลองลดเงื่อนไขลง หรือเปลี่ยนสถานะเป็น “ทั้งหมด”" : "รายการยาจะปรากฏหลัง Agent ดึงข้อมูลจาก JHCIS"} action={filtered ? <Button size="sm" icon={<IconClose size={13} />} onClick={resetFilters}>ล้างตัวกรอง</Button> : null} /></TableMessage> : worklist.rows.map((row) => {
          const open = selected?.sourceDrugId === row.sourceDrugId;
          return <Fragment key={row.sourceDrugId}><tr className={open ? "row-selected" : undefined}><td className="cell-code">{row.drugcode}</td><td className="max-w-56"><div className="font-medium">{row.drugname ?? row.drugnamethai ?? "—"}</div>{row.druggenericname ? <div className="type-help">{row.druggenericname}</div> : null}</td><td><Badge>{row.drugtype === "10" ? "10 · TTMT" : "01 · TMT"}</Badge></td><td className="max-w-72"><MappedStandardSummary row={row} /></td><td>{row.standardSource ? <div className="flex flex-wrap gap-1"><Badge tone={row.standardSource === "TMT" ? "info" : "success"}>{row.standardSource}</Badge><Badge>{row.standardLevel?.toUpperCase()}</Badge></div> : <span className="type-caption">—</span>}</td><td>{row.updateFlag ? <Badge>{row.updateFlag}</Badge> : <span className="type-caption">—</span>}</td><td className="max-w-56"><Badge tone={statusTone(row.status)} dot>{statusLabel(row.status)}</Badge>{row.statusReason ? <div className="type-help mt-1">{row.statusReason}</div> : null}</td><td><Button size="sm" variant={open ? "secondary" : row.standardCode ? "ghost" : "outline"} icon={open ? <IconClose size={13} /> : <IconLink size={13} />} disabled={busy !== null && busy !== row.sourceDrugId} loading={busy === row.sourceDrugId} onClick={() => openChooser(row)}>{open ? "ปิด" : row.standardCode ? "แก้ไข" : "จับคู่"}</Button></td></tr>
            {open ? <tr className="hover:bg-transparent"><td colSpan={COLUMNS} className="border-b-0 bg-primary-50/40 p-0"><div ref={chooserRef} className="border-y border-primary-200 bg-surface p-3.5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="type-card-title">เลือกมาตรฐานให้ <span className="cell-code">{row.drugcode}</span> — {row.drugname ?? row.drugnamethai ?? ""}</h3><p className="type-help mt-0.5">drugtype {row.drugtype} ใช้คลัง {row.drugtype === "10" ? "TTMT" : "TMT"} เท่านั้น</p></div><Button size="sm" icon={<IconClose size={13} />} onClick={() => setSelected(null)}>ปิด</Button></div>
              <MappingComparisonContext row={row} />
              {row.status === "needs_review" && row.standardSource && row.standardCode && row.standardLevel ? <Alert tone="warning" className="mt-3" title="รายการนี้ต้องยืนยันหลังตรวจสอบ"><div className="flex flex-wrap items-center justify-between gap-2"><span>{row.statusReason}</span><Button size="sm" variant="primary" disabled={busy !== null} loading={busy === row.sourceDrugId} onClick={() => void save(row, row.standardSource!, row.standardCode!, row.standardLevel!, true)}>บันทึกและยืนยันว่าตรวจสอบแล้ว</Button></div></Alert> : null}
              <div className="mt-3 flex flex-wrap items-end gap-2.5">
                <Badge tone={row.drugtype === "10" ? "success" : "info"} className="mb-2">คลัง {row.drugtype === "10" ? "TTMT" : "TMT"}</Badge>
                <StandardFilterInputs
                  filters={standardFilters}
                  idPrefix={`mapping-standard-${row.sourceDrugId}`}
                  onChange={(key, value) => setStandardFilters((current) => ({ ...current, [key]: value }))}
                  onClear={clearStandardFilters}
                />
              </div>
              <p className="type-caption mt-2" role="status" aria-live="polite">
                {standardSearchStatus === "idle" && "พิมพ์อย่างน้อย 2 ตัวอักษรในช่องใดช่องหนึ่งเพื่อค้นหา"}
                {standardSearchStatus === "short" && "ต้องพิมพ์อย่างน้อย 2 ตัวอักษรในทุกช่องที่กรอก"}
                {standardSearchStatus === "loading" && "กำลังค้นหา…"}
                {standardSearchStatus === "empty" && "ไม่พบรายการที่ตรงกับตัวกรอง"}
                {standardSearchStatus === "ready" && `พบ ${(row.drugtype === "10" ? ttmtRows : tmtRows).length.toLocaleString("th-TH")} รายการ`}
              </p>
              {standardSearchStatus === "error" ? <div className="mt-2 rounded-lg border border-border"><ErrorState compact title="ค้นหามาตรฐานไม่สำเร็จ" description="ระบบติดต่อคลังมาตรฐานไม่ได้ ตัวกรองที่กรอกไว้ยังคงอยู่" onRetry={() => void searchStandards()} /></div> : null}
              {standardSearchStatus === "loading" ? <div className="mt-3 grid gap-2 sm:grid-cols-2" role="status" aria-label="กำลังโหลดผลค้นหา"><div className="h-28 animate-pulse rounded-lg bg-slate-100" /><div className="hidden h-28 animate-pulse rounded-lg bg-slate-100 sm:block" /></div> : null}
              {standardSearchStatus === "empty" ? <div className="mt-3 rounded-lg border border-border"><EmptyState compact icon={<IconSearch size={18} />} title="ไม่พบรายการที่ตรงกับตัวกรอง" description="ลองลดจำนวนตัวกรองหรือใช้คำค้นอื่น" /></div> : null}
              {row.drugtype === "01" ? <div className="mt-3 space-y-2">{tmtRows.map((item) => {
                const current = isCurrentCandidate(row, "TMT", item.tmtId, item.level);
                return <TmtResultCard key={item.tmtId} comparison current={current} result={{ level: item.level, tmtId: item.tmtId, name: item.endpointFsn ?? item.conceptFsn, activeIngredient: item.activeIngredient, strength: item.strength, dosageForm: item.dosageForm, tradeName: item.tradeName, manufacturer: item.manufacturer, registrationNumber: item.registrationNumber, registrationConflict: item.registrationConflict, status: item.status, mappingEligible: item.mappingEligible, mappingEligibilityReason: item.mappingEligibilityReason }}><Button size="sm" onClick={() => void openDetail(item.tmtId)}>รายละเอียด</Button><Button size="sm" variant={current ? "secondary" : "primary"} disabled={!item.mappingEligible || busy !== null} onClick={() => void save(row, "TMT", item.tmtId, item.level)}>{current ? "เลือกอยู่" : "เลือก"}</Button></TmtResultCard>;
              })}{detail?.concept.level === "gpu" ? <section className="rounded-md border border-border p-3"><h4 className="type-card-title">รายการ TPU ที่เกี่ยวข้อง ({detail.relatedTpu.length})</h4><div className="mt-2 grid gap-2 sm:grid-cols-2">{detail.relatedTpu.map((item) => {
                const current = isCurrentCandidate(row, "TMT", item.tmtId, "tpu");
                return <TmtResultCard key={item.tmtId} comparison current={current} result={{ level: "tpu", tmtId: item.tmtId, name: item.endpointFsn ?? item.conceptFsn, tradeName: item.tradeName, manufacturer: item.manufacturer, registrationNumber: item.registrationNumber, registrationConflict: item.registrationConflict, status: item.status, mappingEligible: item.mappingEligible, mappingEligibilityReason: item.mappingEligibilityReason }}><Button size="sm" variant={current ? "secondary" : "primary"} disabled={!item.mappingEligible || busy !== null} onClick={() => void save(row, "TMT", item.tmtId, "tpu")}>{current ? "เลือกอยู่" : "เลือก TPU"}</Button></TmtResultCard>;
              })}</div></section> : null}</div> : <div className="mt-3 space-y-2">{ttmtRows.map((item) => {
                const current = isCurrentCandidate(row, "TTMT", item.code, "product");
                return <TtmtResultCard key={item.code} comparison current={current} result={item}><Button size="sm" variant={current ? "secondary" : "primary"} disabled={!item.active || busy !== null} onClick={() => void save(row, "TTMT", item.code, "product")}>{current ? "เลือกอยู่" : "เลือก"}</Button></TtmtResultCard>;
              })}</div>}
            </div></td></tr> : null}</Fragment>;
        })}</tbody>}</Table></TableScroll>}
    </CardBody><Pagination page={worklist.page} pageCount={worklist.pageCount} total={worklist.total} disabled={loading} onPageChange={setPage} /></Card>
  </div>;
}
