"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { StandardSearch } from "@/components/standard-search";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FilterBar, SearchInput, SelectInput } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Pagination, Table, TableMessage, TableScroll, TableSkeleton } from "@/components/ui/table";
import { IconClose, IconLink, IconPill, IconRefresh, IconSearch } from "@/components/ui/icons";

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
  status: "pending" | "needs_review" | "mapped";
  statusReason: string | null;
  latestCatalogTmtid: string | null;
}

interface Worklist {
  rows: WorklistRow[];
  total: number;
  page: number;
  pageCount: number;
}

const EMPTY: Worklist = { rows: [], total: 0, page: 1, pageCount: 1 };
const COLUMNS = 8;

export function MappingWorkbench({ hasCatalog }: { hasCatalog: boolean }) {
  const { push } = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "needs_review" | "mapped">("pending");
  const [drugType, setDrugType] = useState<"all" | "01" | "10">("all");
  const [page, setPage] = useState(1);
  const [worklist, setWorklist] = useState<Worklist>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
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
        setFailed(true);
        push("error", "โหลดรายการยาไม่สำเร็จ");
        return;
      }
      setFailed(false);
      setWorklist({ rows: result.rows ?? [], total: result.total ?? 0, page: result.page ?? 1, pageCount: result.pageCount ?? 1 });
    } catch {
      if (requestIdRef.current === requestId) setFailed(true);
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
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        created?: number;
        updated?: number;
        needsReview?: number;
        skippedNoStandard?: number;
        skippedTypeMismatch?: number;
      };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "จับคู่อัตโนมัติไม่สำเร็จ");
        return;
      }
      push(
        "ok",
        `สร้าง ${result.created?.toLocaleString("th-TH")} · อัปเดต ${result.updated?.toLocaleString("th-TH")} · ` +
          `ต้องตรวจสอบ ${result.needsReview?.toLocaleString("th-TH")} · ` +
          `ไม่พบมาตรฐาน ${result.skippedNoStandard?.toLocaleString("th-TH")} · ชนิดไม่ตรง ${result.skippedTypeMismatch?.toLocaleString("th-TH")}`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function saveMapping(row: WorklistRow, standardCode: string, confirmReview = false) {
    setBusy(row.sourceDrugId);
    try {
      const response = await fetch("/api/v1/mappings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceDrugId: row.sourceDrugId, standardCode, confirmReview }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; updateFlag?: string };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "บันทึกไม่สำเร็จ");
        return;
      }
      push(
        "ok",
        confirmReview
          ? `ตรวจสอบและยืนยัน ${row.drugcode} แล้ว`
          : `จับคู่ ${row.drugcode} → ${standardCode} แล้ว (UPDATEFLAG ${result.updateFlag}) พร้อมส่งออกทันที`,
      );
      setSelected(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  function resetFilters() {
    setQuery("");
    setStatus("pending");
    setDrugType("all");
    setPage(1);
  }

  const filtered = query.trim().length > 0 || status !== "pending" || drugType !== "all";

  return (
    <div className="space-y-3.5">
      <Card>
        <CardBody>
          <FilterBar
            actions={
              <>
                <Button size="sm" icon={<IconClose size={13} />} disabled={!filtered} onClick={resetFilters}>
                  ล้างตัวกรอง
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<IconRefresh size={13} />}
                  loading={busy === "reconcile"}
                  disabled={!hasCatalog || busy !== null}
                  onClick={() => void reconcile()}
                >
                  จับคู่อัตโนมัติจาก Drug Catalog
                </Button>
              </>
            }
          >
            <Field label="ค้นหารายการยา" htmlFor="worklist-query" className="min-w-52 flex-1">
              <SearchInput
                id="worklist-query"
                placeholder="รหัสยา หรือชื่อยา"
                value={query}
                autoComplete="off"
                onChange={(event) => {
                  setPage(1);
                  setQuery(event.target.value);
                }}
              />
            </Field>
            <Field label="สถานะ" htmlFor="worklist-status">
              <SelectInput
                id="worklist-status"
                className="w-32"
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value as typeof status);
                }}
              >
                <option value="pending">คงค้าง</option>
                <option value="needs_review">ต้องตรวจสอบ</option>
                <option value="mapped">จับคู่แล้ว</option>
                <option value="all">ทั้งหมด</option>
              </SelectInput>
            </Field>
            <Field label="ประเภท" htmlFor="worklist-type">
              <SelectInput
                id="worklist-type"
                className="w-32"
                value={drugType}
                onChange={(event) => {
                  setPage(1);
                  setDrugType(event.target.value as typeof drugType);
                }}
              >
                <option value="all">ทั้งหมด</option>
                <option value="01">01 (TMT)</option>
                <option value="10">10 (TTMT)</option>
              </SelectInput>
            </Field>
          </FilterBar>

          {!hasCatalog ? (
            <Alert tone="warning" className="mt-3" title="ยังไม่มีไฟล์ Drug Catalog สำหรับสถานบริการนี้">
              การจับคู่อัตโนมัติอ้างอิงไฟล์ Drug Catalog เท่านั้น จึงยังใช้งานไม่ได้ — จับคู่ทีละรายการด้วยตนเองได้ตามปกติ
            </Alert>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="รายการยาจาก JHCIS"
          description="เทียบรายการฝั่งซ้ายกับมาตรฐานฝั่งขวาเพื่อตรวจว่าจับคู่ถูกต้อง"
          actions={
            <span className="type-caption tabular-nums" role="status" aria-live="polite">
              {loading ? "กำลังโหลด…" : `${worklist.total.toLocaleString("th-TH")} รายการ`}
            </span>
          }
        />

        <CardBody flush className="pt-3">
          {failed ? (
            <ErrorState
              title="โหลดรายการยาไม่สำเร็จ"
              description="ระบบดึงรายการยาจากฐานข้อมูลไม่ได้ในขณะนี้ ตัวกรองที่เลือกไว้ยังคงอยู่"
              onRetry={() => void load()}
            />
          ) : (
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>รหัสยา JHCIS</th>
                    <th>ชื่อยาใน JHCIS</th>
                    <th>ชนิด</th>
                    <th>จับคู่กับมาตรฐาน (จาก TMT API)</th>
                    <th>FLAG</th>
                    <th>ที่มา</th>
                    <th>สถานะ</th>
                    <th className="w-0" />
                  </tr>
                </thead>

                {loading && worklist.rows.length === 0 ? (
                  <TableSkeleton rows={8} columns={COLUMNS} />
                ) : (
                  <tbody>
                    {worklist.rows.length === 0 ? (
                      <TableMessage colSpan={COLUMNS}>
                        <EmptyState
                          compact
                          icon={filtered ? <IconSearch size={18} /> : <IconPill size={18} />}
                          title={filtered ? "ไม่พบรายการตามตัวกรองนี้" : "ยังไม่มีรายการยาที่คงค้าง"}
                          description={
                            filtered
                              ? "ลองลดเงื่อนไขลง หรือเปลี่ยนสถานะเป็น “ทั้งหมด” เพื่อดูรายการที่จับคู่แล้ว"
                              : "รายการยาจะปรากฏที่นี่หลังจาก Agent ดึงข้อมูลจาก JHCIS เข้ามา"
                          }
                          action={
                            filtered ? (
                              <Button size="sm" icon={<IconClose size={13} />} onClick={resetFilters}>
                                ล้างตัวกรอง
                              </Button>
                            ) : null
                          }
                        />
                      </TableMessage>
                    ) : (
                      worklist.rows.map((row) => {
                        const open = selected?.sourceDrugId === row.sourceDrugId;
                        return (
                          <Fragment key={row.sourceDrugId}>
                            <tr className={open ? "row-selected" : undefined}>
                              <td className="cell-code">{row.drugcode}</td>
                              <td className="max-w-56">
                                <div className="font-medium">{row.drugname ?? row.drugnamethai ?? "—"}</div>
                                {row.druggenericname ? <div className="type-help">{row.druggenericname}</div> : null}
                              </td>
                              <td>
                                <Badge>{row.drugtype === "10" ? "10 · TTMT" : "01 · TMT"}</Badge>
                              </td>

                              {/* Both sides of the pairing, so it can be judged by
                                  reading across the row instead of opening each one. */}
                              <td className="max-w-80">
                                {row.standardCode ? (
                                  <div className="border-l-2 border-primary-200 pl-2.5">
                                    {/* Generic name and strength lead: they are what
                                        says the pairing is right. The brand follows. */}
                                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                                      <span className="cell-code text-xxs text-slate-500">{row.standardCode}</span>
                                      <span className="font-semibold text-ink">
                                        {row.activeIngredient ?? "—"}
                                        {row.strength ? <span> · {row.strength}</span> : null}
                                      </span>
                                    </div>
                                    {row.tradeName ? <div className="text-xxs text-slate-600">{row.tradeName}</div> : null}
                                    {row.dosageForm || row.manufacturer ? (
                                      <div className="text-xxs text-slate-500">
                                        {row.dosageForm}
                                        {row.dosageForm && row.manufacturer ? " · " : ""}
                                        {/* The manufacturer separates two products that
                                            are otherwise identical, so it carries weight. */}
                                        {row.manufacturer ? <span className="font-semibold text-ink">{row.manufacturer}</span> : null}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <Badge tone="warning" dot>
                                    ยังไม่จับคู่
                                  </Badge>
                                )}
                              </td>
                              <td>{row.updateFlag ? <Badge>{row.updateFlag}</Badge> : <span className="type-caption">—</span>}</td>
                              <td className="type-caption">{row.mappingSource ?? "—"}</td>
                              <td className="max-w-56">
                                <Badge tone={row.status === "needs_review" ? "warning" : row.status === "mapped" ? "success" : "neutral"} dot>
                                  {row.status === "needs_review" ? "ต้องตรวจสอบ" : row.status === "mapped" ? "จับคู่แล้ว" : "คงค้าง"}
                                </Badge>
                                {row.statusReason ? <div className="type-help mt-1">{row.statusReason}</div> : null}
                              </td>
                              <td>
                                <Button
                                  size="sm"
                                  variant={open ? "secondary" : row.standardCode ? "ghost" : "outline"}
                                  icon={open ? <IconClose size={13} /> : <IconLink size={13} />}
                                  disabled={busy !== null && busy !== row.sourceDrugId}
                                  loading={busy === row.sourceDrugId}
                                  onClick={() => setSelected(open ? null : row)}
                                >
                                  {open ? "ปิด" : row.standardCode ? "แก้ไข" : "จับคู่"}
                                </Button>
                              </td>
                            </tr>

                            {open ? (
                              <tr key={`${row.sourceDrugId}-chooser`} className="hover:bg-transparent">
                                <td colSpan={COLUMNS} className="border-b-0 bg-primary-50/40 p-0">
                                  <div ref={chooserRef} className="border-y border-primary-200 bg-surface p-3.5">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <h3 className="type-card-title">
                                          เลือกมาตรฐานให้ <span className="cell-code">{row.drugcode}</span> —{" "}
                                          {row.drugname ?? row.drugnamethai ?? ""}
                                        </h3>
                                        <p className="type-help mt-0.5">
                                          drugtype {row.drugtype} ใช้คลัง {row.drugtype === "10" ? "TTMT" : "TMT"} เท่านั้น
                                          และเลือกได้เฉพาะรายการที่เปิดใช้งาน รหัส TMT เดิมใน JHCIS ไม่ถูกใช้เป็นคำตอบโดยตรง
                                        </p>
                                      </div>
                                      <Button size="sm" icon={<IconClose size={13} />} onClick={() => setSelected(null)}>
                                        ปิด
                                      </Button>
                                    </div>
                                    {row.status === "needs_review" && row.standardCode ? (
                                      <Alert tone="warning" className="mt-3" title="รายการนี้ต้องยืนยันหลังตรวจสอบ">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <span>{row.statusReason}</span>
                                          <Button
                                            size="sm"
                                            variant="primary"
                                            disabled={busy !== null}
                                            loading={busy === row.sourceDrugId}
                                            onClick={() => {
                                              if (row.standardCode) void saveMapping(row, row.standardCode, true);
                                            }}
                                          >
                                            บันทึกและยืนยันว่าตรวจสอบแล้ว
                                          </Button>
                                        </div>
                                      </Alert>
                                    ) : null}
                                    <div className="mt-3">
                                      <StandardSearch
                                        standardType={row.drugtype === "10" ? "TTMT" : "TMT"}
                                        lockType
                                        selectedCode={row.standardCode}
                                        onSelect={(standard) =>
                                          void saveMapping(row, standard.standardCode, row.status === "needs_review")
                                        }
                                      />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                )}
              </Table>
            </TableScroll>
          )}
        </CardBody>

        <Pagination
          page={worklist.page}
          pageCount={worklist.pageCount}
          total={worklist.total}
          disabled={loading}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
