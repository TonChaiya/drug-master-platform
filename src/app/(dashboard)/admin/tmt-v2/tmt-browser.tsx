"use client";

import { useRef, useState, type FormEvent } from "react";
import { TmtLevelBadge } from "@/components/tmt/tmt-level-badge";
import { TmtResultCard } from "@/components/tmt/tmt-result-card";
import { Alert, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FilterBar, SearchInput, SelectInput, TextInput } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { TmtConceptDetail } from "@/modules/tmt/detail";
import type { TmtSearchResult } from "@/modules/tmt/browser";
import type { TmtRelationshipEdge } from "@/modules/tmt/graph";

type SearchResponse = { ok?: boolean; rows?: TmtSearchResult[]; message?: string };
type DetailResponse = { ok?: boolean; detail?: TmtConceptDetail; message?: string };

const LEVELS = ["subs", "vtm", "gp", "gpu", "gpp", "tp", "tpu", "tpp"] as const;

function statusLabel(status: TmtSearchResult["status"]) {
  if (status === "active") return "ใช้งานอยู่";
  if (status === "cancelled") return "ยกเลิกแล้ว";
  return "ยังไม่ทราบ";
}

function Values({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="type-caption">{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}

function Enrichment({ label, item }: { label: string; item: TmtConceptDetail["nlem"] }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="type-caption font-semibold">{label}</span>
        {item?.conflict ? <Badge tone="warning">พบหลายค่าในวันที่ล่าสุด</Badge> : null}
      </div>
      <p className="mt-1 break-words text-xs text-ink">{item?.values.join(", ") || "—"}</p>
      {item ? <p className="type-help mt-0.5">วันที่ข้อมูล {item.changeDate}</p> : null}
    </div>
  );
}

function RelationshipList({ title, rows, onOpen }: { title: string; rows: TmtRelationshipEdge[]; onOpen: (id: string) => void }) {
  return (
    <section>
      <h3 className="type-card-title">{title} <span className="type-caption">({rows.length.toLocaleString("th-TH")})</span></h3>
      <div className="mt-2 space-y-1.5">
        {rows.length === 0 ? <p className="type-help">ไม่พบความสัมพันธ์</p> : rows.map((edge) => (
          <button
            key={`${edge.concept1}:${edge.concept2}:${edge.direction}`}
            type="button"
            className="flex w-full min-w-0 items-start gap-2 rounded-md border border-border px-2.5 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            onClick={() => onOpen(edge.relatedId)}
          >
            <TmtLevelBadge level={edge.relatedLevel} />
            <span className="min-w-0 flex-1">
              <span className="cell-code block">{edge.relatedId}</span>
              <span className="type-help block break-words">{edge.relatedConcept?.fsn ?? "ไม่พบรายละเอียด concept ในข้อมูล TMT ที่ซิงก์ปัจจุบัน"}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TmtBrowser({ mode = "compact" }: { mode?: "compact" | "advanced" }) {
  const [query, setQuery] = useState("");
  const [tmtId, setTmtId] = useState("");
  const [fsn, setFsn] = useState("");
  const [genericName, setGenericName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [registration, setRegistration] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const [eligibility, setEligibility] = useState("");
  const [rows, setRows] = useState<TmtSearchResult[]>([]);
  const [detail, setDetail] = useState<TmtConceptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const advanced = mode === "advanced";

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const hasAdvancedFilter = [tmtId, fsn, genericName, tradeName, manufacturer, registration, level, status, eligibility]
      .some((value) => value.trim() !== "");
    if (advanced ? !hasAdvancedFilter : !query.trim()) {
      setError(advanced ? "กรุณาระบุตัวกรองอย่างน้อย 1 รายการ" : "กรุณากรอกรหัส TMT หรือชื่อยา");
      return;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "30" });
    if (advanced) {
      for (const [key, value] of [
        ["tmtId", tmtId],
        ["fsn", fsn],
        ["genericName", genericName],
        ["tradeName", tradeName],
        ["manufacturer", manufacturer],
        ["registration", registration],
      ]) if (value.trim()) params.set(key, value.trim());
    } else {
      params.set("q", query.trim());
    }
    if (level) params.set("level", level);
    if (status) params.set("status", status);
    if (eligibility) params.set("mappingEligible", eligibility);
    try {
      const response = await fetch(`/api/v1/tmt-v2/search?${params}`);
      const result = (await response.json()) as SearchResponse;
      if (current !== requestId.current) return;
      if (!response.ok || !result.ok) throw new Error(result.message || "ค้นหาข้อมูล TMT ไม่สำเร็จ");
      setRows(result.rows ?? []);
      setDetail(null);
    } catch (cause) {
      if (current === requestId.current) setError(cause instanceof Error ? cause.message : "ค้นหาข้อมูล TMT ไม่สำเร็จ");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }

  function clearFilters() {
    requestId.current += 1;
    setQuery("");
    setTmtId("");
    setFsn("");
    setGenericName("");
    setTradeName("");
    setManufacturer("");
    setRegistration("");
    setLevel("");
    setStatus("");
    setEligibility("");
    setRows([]);
    setDetail(null);
    setError(null);
    setLoading(false);
  }

  async function openDetail(tmtId: string) {
    const current = requestId.current + 1;
    requestId.current = current;
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/tmt-v2/concepts/${encodeURIComponent(tmtId)}?depth=2&maxNodes=200`);
      const result = (await response.json()) as DetailResponse;
      if (current !== requestId.current) return;
      if (!response.ok || !result.ok || !result.detail) throw new Error(result.message || "โหลดรายละเอียด TMT ไม่สำเร็จ");
      setDetail(result.detail);
    } catch (cause) {
      if (current === requestId.current) setError(cause instanceof Error ? cause.message : "โหลดรายละเอียด TMT ไม่สำเร็จ");
    } finally {
      if (current === requestId.current) setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-3.5">
      <Card>
        <CardBody>
          <form onSubmit={(event) => void search(event)}>
            <FilterBar actions={<><Button type="submit" size="sm" variant="primary" loading={loading}>ค้นหา TMT v2</Button>{advanced ? <Button type="button" size="sm" variant="secondary" onClick={clearFilters}>ล้างตัวกรอง</Button> : null}</>}>
              {advanced ? (
                <>
                  <Field label="TMT ID" htmlFor="tmt-v2-id" className="w-full sm:w-44">
                    <TextInput id="tmt-v2-id" value={tmtId} maxLength={20} inputMode="numeric" mono autoComplete="off" onChange={(event) => setTmtId(event.target.value)} />
                  </Field>
                  <Field label="ชื่อยา / FSN" htmlFor="tmt-v2-fsn" className="w-full sm:min-w-64 sm:flex-1">
                    <SearchInput id="tmt-v2-fsn" value={fsn} maxLength={120} autoComplete="off" onChange={(event) => setFsn(event.target.value)} />
                  </Field>
                  <Field label="ชื่อสามัญ" htmlFor="tmt-v2-generic" className="w-full sm:w-56">
                    <SearchInput id="tmt-v2-generic" value={genericName} maxLength={120} autoComplete="off" onChange={(event) => setGenericName(event.target.value)} />
                  </Field>
                  <Field label="ชื่อการค้า" htmlFor="tmt-v2-trade" className="w-full sm:w-56">
                    <SearchInput id="tmt-v2-trade" value={tradeName} maxLength={120} autoComplete="off" onChange={(event) => setTradeName(event.target.value)} />
                  </Field>
                  <Field label="ผู้ผลิต" htmlFor="tmt-v2-manufacturer" className="w-full sm:w-56">
                    <SearchInput id="tmt-v2-manufacturer" value={manufacturer} maxLength={120} autoComplete="off" onChange={(event) => setManufacturer(event.target.value)} />
                  </Field>
                  <Field label="เลขทะเบียนยา" htmlFor="tmt-v2-registration" className="w-full sm:w-52">
                    <SearchInput id="tmt-v2-registration" value={registration} maxLength={120} autoComplete="off" onChange={(event) => setRegistration(event.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label="ค้นหารหัส TMT หรือชื่อยา" htmlFor="tmt-v2-query" className="min-w-60 flex-1">
                  <SearchInput id="tmt-v2-query" value={query} maxLength={120} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
                </Field>
              )}
              <Field label={advanced ? "ระดับ TMT" : "ระดับ"} htmlFor="tmt-v2-level" className={advanced ? "w-full sm:w-auto" : undefined}>
                <SelectInput id="tmt-v2-level" value={level} onChange={(event) => setLevel(event.target.value)}>
                  <option value="">ทุกระดับ</option>
                  {LEVELS.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
                </SelectInput>
              </Field>
              <Field label={advanced ? "สถานะ" : "สถานะ MasterTMT"} htmlFor="tmt-v2-status" className={advanced ? "w-full sm:w-auto" : undefined}>
                <SelectInput id="tmt-v2-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">ทั้งหมด</option><option value="active">ใช้งานอยู่</option><option value="cancelled">ยกเลิกแล้ว</option><option value="unknown">ยังไม่ทราบ</option>
                </SelectInput>
              </Field>
              <Field label="ความพร้อมจับคู่" htmlFor="tmt-v2-eligibility" className={advanced ? "w-full sm:w-auto" : undefined}>
                <SelectInput id="tmt-v2-eligibility" value={eligibility} onChange={(event) => setEligibility(event.target.value)}>
                  <option value="">ทั้งหมด</option><option value="true">พร้อม commercial TPU</option><option value="false">ยังไม่พร้อม</option>
                </SelectInput>
              </Field>
            </FilterBar>
          </form>
          <Alert tone="info" className="mt-3" title="ดูข้อมูลเท่านั้น">
            หน้านี้แสดงตัวอย่างความพร้อมสำหรับ commercial TPU mapping และไม่บันทึกการจับคู่
          </Alert>
          {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
        </CardBody>
      </Card>

      <div className="grid min-w-0 gap-3.5 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.5fr)]">
        <Card className="min-w-0">
          <CardHeader title="ผลการค้นหา" description={loading ? "กำลังค้นหา…" : `${rows.length.toLocaleString("th-TH")} รายการ`} />
          <CardBody className="space-y-2 pt-3">
            {!loading && rows.length === 0 ? <EmptyState compact title="ยังไม่มีผลการค้นหา" description="ค้นหาด้วยรหัส TMT หรือ FSN เพื่อดูรายละเอียด" /> : rows.map((row) => (
              <TmtResultCard key={row.tmtId} result={{
                level: row.level, tmtId: row.tmtId, name: row.endpointFsn ?? row.conceptFsn,
                tradeName: row.tradeName, manufacturer: row.manufacturer,
                registrationNumber: row.registrationNumber, registrationConflict: row.registrationConflict,
                status: row.status, mappingEligible: row.mappingEligible, mappingEligibilityReason: row.mappingEligibilityReason,
              }}>
                <span className="type-help mr-auto self-center">ก่อนหน้า {row.relationships.inbound.toLocaleString("th-TH")} · ถัดไป {row.relationships.outbound.toLocaleString("th-TH")}</span>
                <Button size="sm" onClick={() => void openDetail(row.tmtId)}>รายละเอียด</Button>
              </TmtResultCard>
            ))}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="รายละเอียด concept" description="ความสัมพันธ์คงทิศทาง API concept1 → concept2" />
          <CardBody className="pt-3">
            {detailLoading ? <p role="status" className="type-help">กำลังโหลดรายละเอียด…</p> : !detail ? (
              <EmptyState compact title="เลือกรายการเพื่อดูรายละเอียด" description="ข้อมูลจะเปิดในหน้านี้โดยไม่เปลี่ยนเส้นทางหรือบันทึกข้อมูล" />
            ) : (
              <div className="space-y-4">
                <section>
                  <div className="flex flex-wrap items-center gap-2"><TmtLevelBadge level={detail.concept.level} /><span className="cell-code text-sm">{detail.concept.tmtId}</span></div>
                  <h2 className="mt-2 break-words text-sm font-semibold text-ink">{detail.concept.endpointFsn ?? detail.concept.conceptFsn}</h2>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Values label="Concept FSN" value={detail.concept.conceptFsn} /><Values label="เวอร์ชันข้อมูล TMT" value={detail.concept.sourceVersion} /><Values label="ผู้ผลิต" value={detail.concept.manufacturer} /><Values label="สถานะ" value={statusLabel(detail.concept.status)} /></dl>
                </section>

                <Alert tone={detail.concept.mappingEligible ? "success" : "warning"} title={detail.concept.mappingEligible ? "พร้อมสำหรับการจับคู่" : "ยังไม่พร้อมสำหรับการจับคู่"}>{detail.concept.mappingEligibilityReason}</Alert>

                {detail.masterTmt ? <section><h3 className="type-card-title">รายละเอียด MasterTMT</h3><dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Values label="ชื่อการค้า" value={detail.masterTmt.tradeName} /><Values label="ตัวยาสำคัญ" value={detail.masterTmt.activeIngredient} /><Values label="ความแรง" value={detail.masterTmt.strength} /><Values label="รูปแบบยา" value={detail.masterTmt.dosageForm} /><Values label="ปริมาณ" value={[detail.masterTmt.contentValue, detail.masterTmt.contentUnit].filter(Boolean).join(" ")} /><Values label="หน่วยจ่าย" value={detail.masterTmt.dispensingUnit} /></dl></section> : null}

                <section><h3 className="type-card-title">ข้อมูลเสริมล่าสุด</h3><div className="mt-2 grid gap-3 sm:grid-cols-3"><Enrichment label="NLEM" item={detail.nlem} /><Enrichment label="ATC" item={detail.atc} /><Enrichment label="เลขทะเบียนยา" item={detail.regno} /></div></section>

                {detail.warnings.length > 0 ? <Alert tone="warning" title="ข้อสังเกตคุณภาพข้อมูล"><ul className="list-inside list-disc">{detail.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></Alert> : null}

                {detail.relatedTpu.length > 0 ? <section><h3 className="type-card-title">รายการ TPU ที่เกี่ยวข้อง</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{detail.relatedTpu.map((tpu) => <TmtResultCard key={tpu.tmtId} result={{
                  level: "tpu", tmtId: tpu.tmtId, name: tpu.endpointFsn ?? tpu.conceptFsn,
                  tradeName: tpu.tradeName, manufacturer: tpu.manufacturer,
                  registrationNumber: tpu.registrationNumber, registrationConflict: tpu.registrationConflict,
                  status: tpu.status, mappingEligible: tpu.mappingEligible, mappingEligibilityReason: tpu.mappingEligibilityReason,
                }}><Button size="sm" onClick={() => void openDetail(tpu.tmtId)}>รายละเอียด</Button></TmtResultCard>)}</div></section> : null}

                <div className="grid gap-4 lg:grid-cols-2"><RelationshipList title="ความสัมพันธ์ก่อนหน้า" rows={detail.direct.inbound} onOpen={(id) => void openDetail(id)} /><RelationshipList title="ความสัมพันธ์ถัดไป" rows={detail.direct.outbound} onOpen={(id) => void openDetail(id)} /></div>
                <p className="type-help">กราฟที่โหลด: {detail.graph.nodes.length.toLocaleString("th-TH")} concept · {detail.graph.edges.length.toLocaleString("th-TH")} relationship{detail.graph.truncated ? " · แสดงถึงขีดจำกัดที่กำหนด" : ""}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
