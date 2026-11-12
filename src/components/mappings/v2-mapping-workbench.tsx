"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/toast";
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
const EMPTY: Worklist = { rows: [], total: 0, page: 1, pageSize: 30, pageCount: 1 };
const COLUMNS = 8;

function statusLabel(status: V2WorklistRow["status"]): string {
  return status === "needs_review" ? "ต้องตรวจสอบ" : status === "mapped" ? "จับคู่แล้ว" : "คงค้าง";
}
function statusTone(status: V2WorklistRow["status"]): "warning" | "success" | "neutral" {
  return status === "needs_review" ? "warning" : status === "mapped" ? "success" : "neutral";
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
  const [standardQuery, setStandardQuery] = useState("");
  const [tmtRows, setTmtRows] = useState<TmtSearchResult[]>([]);
  const [ttmtRows, setTtmtRows] = useState<TtmtResult[]>([]);
  const [detail, setDetail] = useState<TmtConceptDetail | null>(null);
  const chooserRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

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
    setStandardQuery(""); setTmtRows([]); setTtmtRows([]); setDetail(null);
  }
  async function searchStandards(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (standardQuery.trim().length < 2) return push("warning", "กรุณาค้นหาอย่างน้อย 2 ตัวอักษร");
    setBusy("search");
    try {
      if (selected.drugtype === "01") {
        const response = await fetch(`/api/v1/tmt-v2/search?q=${encodeURIComponent(standardQuery.trim())}&limit=30`);
        const payload = (await response.json()) as { ok?: boolean; rows?: TmtSearchResult[]; message?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.message ?? "ค้นหา TMT ไม่สำเร็จ");
        setTmtRows(payload.rows ?? []); setTtmtRows([]);
      } else {
        const response = await fetch(`/api/v1/mappings/v2/standards?source=TTMT&q=${encodeURIComponent(standardQuery.trim())}`);
        const payload = (await response.json()) as { ok?: boolean; rows?: TtmtResult[]; message?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.message ?? "ค้นหา TTMT ไม่สำเร็จ");
        setTtmtRows(payload.rows ?? []); setTmtRows([]);
      }
    } catch (error) { push("error", error instanceof Error ? error.message : "ค้นหามาตรฐานไม่สำเร็จ"); }
    finally { setBusy(null); }
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
    <Card><CardBody><FilterBar actions={<><Button size="sm" icon={<IconClose size={13} />} disabled={!filtered} onClick={resetFilters}>ล้างตัวกรอง</Button>{reconcileAvailable ? <Button size="sm" variant="primary" icon={<IconRefresh size={13} />} loading={busy === "reconcile"} disabled={busy !== null} onClick={() => void reconcile()}>จับคู่อัตโนมัติจาก Drug Catalog</Button> : null}</>}>
      <Field label="ค้นหารายการยา" htmlFor="mapping-v2-worklist-query" className="min-w-52 flex-1"><SearchInput id="mapping-v2-worklist-query" placeholder="รหัสยา หรือชื่อยา" value={query} autoComplete="off" onChange={(event) => { setPage(1); setQuery(event.target.value); }} /></Field>
      <Field label="สถานะ" htmlFor="mapping-v2-worklist-status"><SelectInput id="mapping-v2-worklist-status" className="w-32" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as LifecycleFilter); }}><option value="pending">คงค้าง</option><option value="needs_review">ต้องตรวจสอบ</option><option value="mapped">จับคู่แล้ว</option><option value="all">ทั้งหมด</option></SelectInput></Field>
      <Field label="ประเภท" htmlFor="mapping-v2-worklist-type"><SelectInput id="mapping-v2-worklist-type" className="w-32" value={drugType} onChange={(event) => { setPage(1); setDrugType(event.target.value as DrugTypeFilter); }}><option value="all">ทั้งหมด</option><option value="01">01 · TMT</option><option value="10">10 · TTMT</option></SelectInput></Field>
    </FilterBar></CardBody></Card>
    <Card><CardHeader title="รายการยาจาก JHCIS" description="ค้นหา กรอง และจับคู่ด้วยมาตรฐาน TMT/TTMT ตามชนิดยา" actions={<span className="type-caption tabular-nums" role="status" aria-live="polite">{loading ? "กำลังโหลด…" : `${worklist.total.toLocaleString("th-TH")} รายการ`}</span>} /><CardBody flush className="pt-3">
      {failed ? <ErrorState title="โหลดรายการยาไม่สำเร็จ" description="ระบบดึงรายการยาจากฐานข้อมูลไม่ได้ในขณะนี้ ตัวกรองที่เลือกไว้ยังคงอยู่" onRetry={() => void load()} /> : <TableScroll><Table><thead><tr><th>รหัสยา JHCIS</th><th>ชื่อยาใน JHCIS</th><th>ชนิด</th><th>มาตรฐานปัจจุบัน</th><th>แหล่ง / ระดับ</th><th>FLAG</th><th>สถานะ</th><th className="w-0">การทำงาน</th></tr></thead>
        {loading && worklist.rows.length === 0 ? <TableSkeleton rows={8} columns={COLUMNS} /> : <tbody>{worklist.rows.length === 0 ? <TableMessage colSpan={COLUMNS}><EmptyState compact icon={filtered ? <IconSearch size={18} /> : <IconPill size={18} />} title={filtered ? "ไม่พบรายการตามตัวกรองนี้" : "ยังไม่มีรายการยาที่คงค้าง"} description={filtered ? "ลองลดเงื่อนไขลง หรือเปลี่ยนสถานะเป็น “ทั้งหมด”" : "รายการยาจะปรากฏหลัง Agent ดึงข้อมูลจาก JHCIS"} action={filtered ? <Button size="sm" icon={<IconClose size={13} />} onClick={resetFilters}>ล้างตัวกรอง</Button> : null} /></TableMessage> : worklist.rows.map((row) => {
          const open = selected?.sourceDrugId === row.sourceDrugId;
          return <Fragment key={row.sourceDrugId}><tr className={open ? "row-selected" : undefined}><td className="cell-code">{row.drugcode}</td><td className="max-w-56"><div className="font-medium">{row.drugname ?? row.drugnamethai ?? "—"}</div>{row.druggenericname ? <div className="type-help">{row.druggenericname}</div> : null}</td><td><Badge>{row.drugtype === "10" ? "10 · TTMT" : "01 · TMT"}</Badge></td><td className="max-w-72">{row.standardCode ? <div className="border-l-2 border-primary-200 pl-2.5"><div className="cell-code text-xxs text-slate-500">{row.standardCode}</div>{row.standardName ? <div className="font-medium">{row.standardName}</div> : null}{row.standardTradeName ? <div className="type-help">{row.standardTradeName}</div> : null}{row.standardManufacturer ? <div className="type-help">{row.standardManufacturer}</div> : null}</div> : <Badge tone="warning" dot>ยังไม่จับคู่</Badge>}</td><td>{row.standardSource ? <div className="flex flex-wrap gap-1"><Badge tone={row.standardSource === "TMT" ? "info" : "success"}>{row.standardSource}</Badge><Badge>{row.standardLevel?.toUpperCase()}</Badge></div> : <span className="type-caption">—</span>}</td><td>{row.updateFlag ? <Badge>{row.updateFlag}</Badge> : <span className="type-caption">—</span>}</td><td className="max-w-56"><Badge tone={statusTone(row.status)} dot>{statusLabel(row.status)}</Badge>{row.statusReason ? <div className="type-help mt-1">{row.statusReason}</div> : null}</td><td><Button size="sm" variant={open ? "secondary" : row.standardCode ? "ghost" : "outline"} icon={open ? <IconClose size={13} /> : <IconLink size={13} />} disabled={busy !== null && busy !== row.sourceDrugId} loading={busy === row.sourceDrugId} onClick={() => openChooser(row)}>{open ? "ปิด" : row.standardCode ? "แก้ไข" : "จับคู่"}</Button></td></tr>
            {open ? <tr className="hover:bg-transparent"><td colSpan={COLUMNS} className="border-b-0 bg-primary-50/40 p-0"><div ref={chooserRef} className="border-y border-primary-200 bg-surface p-3.5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="type-card-title">เลือกมาตรฐานให้ <span className="cell-code">{row.drugcode}</span> — {row.drugname ?? row.drugnamethai ?? ""}</h3><p className="type-help mt-0.5">drugtype {row.drugtype} ใช้คลัง {row.drugtype === "10" ? "TTMT" : "TMT"} เท่านั้น</p></div><Button size="sm" icon={<IconClose size={13} />} onClick={() => setSelected(null)}>ปิด</Button></div>
              {row.status === "needs_review" && row.standardSource && row.standardCode && row.standardLevel ? <Alert tone="warning" className="mt-3" title="รายการนี้ต้องยืนยันหลังตรวจสอบ"><div className="flex flex-wrap items-center justify-between gap-2"><span>{row.statusReason}</span><Button size="sm" variant="primary" disabled={busy !== null} loading={busy === row.sourceDrugId} onClick={() => void save(row, row.standardSource!, row.standardCode!, row.standardLevel!, true)}>บันทึกและยืนยันว่าตรวจสอบแล้ว</Button></div></Alert> : null}
              <form className="mt-3 flex gap-2" onSubmit={(event) => void searchStandards(event)}><SearchInput value={standardQuery} onChange={(event) => setStandardQuery(event.target.value)} placeholder={row.drugtype === "10" ? "รหัสหรือชื่อ TTMT" : "รหัส TMT หรือ FSN"} /><Button type="submit" variant="primary" loading={busy === "search"}>ค้นหา</Button></form>
              {row.drugtype === "01" ? <div className="mt-3 space-y-2">{tmtRows.map((item) => <TmtResultCard key={item.tmtId} result={{ level: item.level, tmtId: item.tmtId, name: item.endpointFsn ?? item.conceptFsn, tradeName: item.tradeName, manufacturer: item.manufacturer, registrationNumber: item.registrationNumber, registrationConflict: item.registrationConflict, status: item.status, mappingEligible: item.mappingEligible, mappingEligibilityReason: item.mappingEligibilityReason }}><Button size="sm" onClick={() => void openDetail(item.tmtId)}>รายละเอียด</Button><Button size="sm" variant="primary" disabled={!item.mappingEligible || busy !== null} onClick={() => void save(row, "TMT", item.tmtId, item.level)}>เลือก</Button></TmtResultCard>)}{detail?.concept.level === "gpu" ? <section className="rounded-md border border-border p-3"><h4 className="type-card-title">รายการ TPU ที่เกี่ยวข้อง ({detail.relatedTpu.length})</h4><div className="mt-2 grid gap-2 sm:grid-cols-2">{detail.relatedTpu.map((item) => <TmtResultCard key={item.tmtId} result={{ level: "tpu", tmtId: item.tmtId, name: item.endpointFsn ?? item.conceptFsn, tradeName: item.tradeName, manufacturer: item.manufacturer, registrationNumber: item.registrationNumber, registrationConflict: item.registrationConflict, status: item.status, mappingEligible: item.mappingEligible, mappingEligibilityReason: item.mappingEligibilityReason }}><Button size="sm" variant="primary" disabled={!item.mappingEligible || busy !== null} onClick={() => void save(row, "TMT", item.tmtId, "tpu")}>เลือก TPU</Button></TmtResultCard>)}</div></section> : null}</div> : <div className="mt-3 space-y-2">{ttmtRows.map((item) => <TtmtResultCard key={item.code} result={item}><Button size="sm" variant="primary" disabled={!item.active || busy !== null} onClick={() => void save(row, "TTMT", item.code, "product")}>เลือก</Button></TtmtResultCard>)}</div>}
            </div></td></tr> : null}</Fragment>;
        })}</tbody>}</Table></TableScroll>}
    </CardBody><Pagination page={worklist.page} pageCount={worklist.pageCount} total={worklist.total} disabled={loading} onPageChange={setPage} /></Card>
  </div>;
}
