"use client";

import { useEffect, useState, type FormEvent } from "react";
import { TmtResultCard } from "@/components/tmt/tmt-result-card";
import { TtmtResultCard, type TtmtResult } from "@/components/ttmt/ttmt-result-card";
import { Alert, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, SearchInput, SelectInput } from "@/components/ui/form";
import { loadV2SavedIdentity, type V2SavedIdentity } from "@/components/mappings/v2-saved-identity";
import type { TmtConceptDetail } from "@/modules/tmt/detail";
import type { TmtSearchResult } from "@/modules/tmt/browser";

type SourceDrug = { id: string; drugcode: string; drugname: string | null; drugnamethai: string | null; drugtype: string };

export function V2MappingWorkbench({ sourceDrugs }: { sourceDrugs: SourceDrug[] }) {
  const [sourceDrugId, setSourceDrugId] = useState(sourceDrugs[0]?.id ?? "");
  const selectedDrug = sourceDrugs.find((row) => row.id === sourceDrugId) ?? null;
  const standardSource = selectedDrug?.drugtype === "10" ? "TTMT" : "TMT";
  const [query, setQuery] = useState("");
  const [tmtRows, setTmtRows] = useState<TmtSearchResult[]>([]);
  const [ttmtRows, setTtmtRows] = useState<TtmtResult[]>([]);
  const [detail, setDetail] = useState<TmtConceptDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedIdentity, setSavedIdentity] = useState<V2SavedIdentity | null>(null);

  useEffect(() => {
    let current = true;
    if (!sourceDrugId) return () => { current = false; };
    void loadV2SavedIdentity(sourceDrugId)
      .then((identity) => { if (current) setSavedIdentity(identity); })
      .catch((cause: unknown) => { if (current) setMessage(cause instanceof Error ? cause.message : "โหลดการจับคู่ล่าสุดไม่สำเร็จ"); });
    return () => { current = false; };
  }, [sourceDrugId]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return setMessage("กรุณาค้นหาอย่างน้อย 2 ตัวอักษร");
    setBusy(true);
    setMessage(null);
    try {
      if (standardSource === "TMT") {
        const response = await fetch(`/api/v1/tmt-v2/search?q=${encodeURIComponent(query.trim())}&limit=30`);
        const payload = (await response.json()) as { ok?: boolean; rows?: TmtSearchResult[]; message?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.message ?? "ค้นหา TMT ไม่สำเร็จ");
        setTmtRows(payload.rows ?? []); setTtmtRows([]);
      } else {
        const response = await fetch(`/api/v1/mappings/v2/standards?source=TTMT&q=${encodeURIComponent(query.trim())}`);
        const payload = (await response.json()) as { ok?: boolean; rows?: TtmtResult[]; message?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.message ?? "ค้นหา TTMT ไม่สำเร็จ");
        setTtmtRows(payload.rows ?? []); setTmtRows([]);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "ค้นหามาตรฐานไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function openDetail(tmtId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/tmt-v2/concepts/${encodeURIComponent(tmtId)}?depth=1&maxNodes=50`);
      const payload = (await response.json()) as { ok?: boolean; detail?: TmtConceptDetail; message?: string };
      if (!response.ok || !payload.ok || !payload.detail) throw new Error(payload.message ?? "โหลดรายละเอียด TMT ไม่สำเร็จ");
      setDetail(payload.detail);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "โหลดรายละเอียด TMT ไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function reloadMapping() {
    if (!selectedDrug) return;
    setSavedIdentity(await loadV2SavedIdentity(selectedDrug.id));
  }

  async function save(source: "TMT" | "TTMT", code: string, level: string, confirmReview = false) {
    if (!selectedDrug) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/v1/mappings/v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceDrugId: selectedDrug.id, standardSource: source, standardCode: code, standardLevel: level, confirmReview }) });
      const payload = (await response.json()) as { ok?: boolean; message?: string; updateFlag?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "บันทึกการจับคู่ไม่สำเร็จ");
      await reloadMapping();
      setMessage(confirmReview ? `บันทึกและยืนยัน ${selectedDrug.drugcode} แล้ว` : `บันทึก ${selectedDrug.drugcode} → ${code} แล้ว (UPDATEFLAG ${payload.updateFlag ?? "—"})`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "บันทึกการจับคู่ไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3.5">
    <Card><CardHeader title="การจับคู่รายการยา" description="จับคู่ด้วย identity TMT/TTMT แบบแยก source และ level" /><CardBody className="space-y-3">
      <Field label="รายการยา JHCIS" htmlFor="mapping-v2-source"><SelectInput id="mapping-v2-source" value={sourceDrugId} onChange={(event) => { setSourceDrugId(event.target.value); setQuery(""); setTmtRows([]); setTtmtRows([]); setDetail(null); setSavedIdentity(null); setMessage(null); }}>
        {sourceDrugs.map((drug) => <option key={drug.id} value={drug.id}>{drug.drugcode} · {drug.drugname ?? drug.drugnamethai ?? "—"} ({drug.drugtype})</option>)}
      </SelectInput></Field>
      <Badge tone={standardSource === "TMT" ? "info" : "success"}>เลือกจากคลัง {standardSource} เท่านั้น</Badge>
      <form className="flex gap-2" onSubmit={(event) => void search(event)}><SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={standardSource === "TMT" ? "รหัส TMT หรือ FSN" : "รหัสหรือชื่อ TTMT"} /><Button type="submit" variant="primary" loading={busy}>ค้นหา</Button></form>
      {message ? <Alert tone={message.startsWith("บันทึก") ? "success" : "warning"}>{message}</Alert> : null}
      {savedIdentity ? <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs"><Badge tone="info">{savedIdentity.source}</Badge><span className="cell-code">{savedIdentity.code}</span><Badge>{savedIdentity.level.toUpperCase()}</Badge><Button size="sm" disabled={busy} onClick={() => void save(savedIdentity.source, savedIdentity.code, savedIdentity.level, true)}>บันทึกและยืนยันว่าตรวจสอบแล้ว</Button></div> : null}
    </CardBody></Card>
    {standardSource === "TMT" ? <Card><CardHeader title="ผลค้นหา TMT" description="ทุกระดับแสดงได้ แต่ backend อนุญาตเฉพาะ TPU ที่ active สำหรับ PRODUCTCAT 1" /><CardBody className="space-y-2">
      {tmtRows.map((row) => <TmtResultCard key={row.tmtId} result={{
        level: row.level, tmtId: row.tmtId, name: row.endpointFsn ?? row.conceptFsn,
        tradeName: row.tradeName, manufacturer: row.manufacturer,
        registrationNumber: row.registrationNumber, registrationConflict: row.registrationConflict,
        status: row.status, mappingEligible: row.mappingEligible, mappingEligibilityReason: row.mappingEligibilityReason,
      }}><Button size="sm" onClick={() => void openDetail(row.tmtId)}>รายละเอียด</Button><Button size="sm" variant="primary" disabled={!row.mappingEligible || busy} onClick={() => void save("TMT", row.tmtId, row.level)}>เลือก</Button></TmtResultCard>)}
      {detail?.concept.level === "gpu" ? <section className="rounded-md border border-border p-3"><h3 className="type-card-title">รายการ TPU ที่เกี่ยวข้อง ({detail.relatedTpu.length})</h3><p className="type-help">{detail.concept.mappingEligibilityReason}</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{detail.relatedTpu.map((row) => <TmtResultCard key={row.tmtId} result={{
        level: "tpu", tmtId: row.tmtId, name: row.endpointFsn ?? row.conceptFsn,
        tradeName: row.tradeName, manufacturer: row.manufacturer,
        registrationNumber: row.registrationNumber, registrationConflict: row.registrationConflict,
        status: row.status, mappingEligible: row.mappingEligible, mappingEligibilityReason: row.mappingEligibilityReason,
      }}><Button size="sm" onClick={() => void openDetail(row.tmtId)}>รายละเอียด</Button><Button size="sm" variant="primary" disabled={!row.mappingEligible || busy} onClick={() => void save("TMT", row.tmtId, "tpu")}>เลือก TPU</Button></TmtResultCard>)}</div></section> : null}
    </CardBody></Card> : <Card><CardHeader title="ผลค้นหา TTMT" description="TTMT เป็นผลิตภัณฑ์ ไม่มี graph หรือสีระดับ GP/GPU/TP/TPU" /><CardBody className="space-y-2">{ttmtRows.map((row) => <TtmtResultCard key={row.code} result={row}><Button size="sm" variant="primary" disabled={!row.active || busy} onClick={() => void save("TTMT", row.code, "product")}>เลือก</Button></TtmtResultCard>)}</CardBody></Card>}
  </div>;
}
