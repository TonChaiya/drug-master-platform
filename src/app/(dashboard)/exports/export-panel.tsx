"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Choice } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StickyHead, Table, TableMessage, TableScroll, TableSkeleton } from "@/components/ui/table";
import { IconDownload, IconExport } from "@/components/ui/icons";

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

const SELECTIONS: Array<{ value: Selection; label: string; description: string }> = [
  {
    value: "all-mapped",
    label: "ทั้งหมดที่จับคู่แล้ว",
    description: "ทุกรายการยาของสถานบริการนี้ที่มีรหัสมาตรฐานแล้ว",
  },
  {
    value: "manual-changes",
    label: "เฉพาะที่จับคู่ใหม่หรือแก้ไข",
    description: "ส่งเฉพาะส่วนต่างตั้งแต่การส่งออกครั้งก่อน",
  },
];

const COLUMNS = 11;

export function ExportPanel() {
  const { push } = useToast();
  const [selection, setSelection] = useState<Selection>("all-mapped");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Does not raise the loading flag itself: it runs from an effect, and setting
  // state synchronously there costs an extra render pass. The flag starts true
  // and is raised again by whatever triggers a reload.
  const loadPreview = useCallback(async () => {
    // Built before the try so nothing inside it can throw before the first
    // await: a catch reachable synchronously would put a setState in the
    // effect's own render pass.
    const url = `/api/v1/exports/preview?selection=${selection}&limit=100`;
    try {
      const response = await fetch(url);
      const result = (await response.json()) as { ok?: boolean; message?: string; total?: number; rows?: PreviewRow[] };
      if (!response.ok || !result.ok) {
        setFailed(true);
        push("error", result.message ?? "โหลดตัวอย่างไม่สำเร็จ");
        setRows([]);
        setTotal(0);
        return;
      }
      setFailed(false);
      setRows(result.rows ?? []);
      setTotal(result.total ?? 0);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [push, selection]);

  // Scheduled rather than called outright, which keeps the request and the
  // state it sets off the effect's own synchronous path, and collapses a rapid
  // toggle between the two selections into a single fetch.
  useEffect(() => {
    const timer = setTimeout(() => void loadPreview(), 0);
    return () => clearTimeout(timer);
  }, [loadPreview]);

  function reload() {
    setLoading(true);
    void loadPreview();
  }

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
    <div className="space-y-3.5">
      <Card>
        <CardHeader
          title="เลือกชุดข้อมูลที่จะส่งออก"
          description="ไฟล์ใช้แม่แบบหัวตาราง 22 คอลัมน์เดิม รหัสทุกช่องเขียนเป็นข้อความเพื่อไม่ให้เลขศูนย์นำหน้าหาย และวันที่เป็นชนิดวันที่จริงรูปแบบ dd/mm/yyyy"
          actions={
            <Button
              variant="primary"
              icon={<IconDownload size={15} />}
              loading={downloading}
              disabled={loading || total === 0}
              onClick={() => void download()}
            >
              ดาวน์โหลด .xls
              {total > 0 ? ` (${total.toLocaleString("th-TH")} แถว)` : ""}
            </Button>
          }
        />
        <CardBody>
          <fieldset className="grid gap-1 sm:grid-cols-2">
            <legend className="sr-only">ชุดข้อมูลที่จะส่งออก</legend>
            {SELECTIONS.map((option) => (
              <Choice
                key={option.value}
                type="radio"
                name="selection"
                id={`selection-${option.value}`}
                value={option.value}
                label={option.label}
                description={option.description}
                checked={selection === option.value}
                onChange={() => {
                  setLoading(true);
                  setSelection(option.value);
                }}
              />
            ))}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="แถวจริงที่จะถูกเขียนลงไฟล์"
          description="ตรวจค่าที่นี่ได้ก่อนดาวน์โหลด ไม่มีการเติมข้อมูลที่ต้นทางไม่มี"
          actions={
            <span className="type-caption tabular-nums" role="status" aria-live="polite">
              {loading
                ? "กำลังโหลด…"
                : `ทั้งหมด ${total.toLocaleString("th-TH")} แถว · แสดง ${rows.length.toLocaleString("th-TH")} แถวแรก`}
            </span>
          }
        />
        <CardBody flush className="pt-3">
          {failed ? (
            <ErrorState
              title="โหลดตัวอย่างไม่สำเร็จ"
              description="ระบบสร้างตัวอย่างแถวจากฐานข้อมูลไม่ได้ในขณะนี้"
              onRetry={reload}
            />
          ) : (
            <TableScroll maxHeight="32rem">
              <Table>
                <StickyHead>
                  <tr>
                    <th className="w-0">#</th>
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
                </StickyHead>

                {loading && rows.length === 0 ? (
                  <TableSkeleton rows={6} columns={COLUMNS} />
                ) : (
                  <tbody>
                    {rows.length === 0 ? (
                      <TableMessage colSpan={COLUMNS}>
                        <EmptyState
                          compact
                          icon={<IconExport size={18} />}
                          title="ยังไม่มีรายการในชุดนี้"
                          description={
                            selection === "manual-changes"
                              ? "ไม่มีรายการที่จับคู่ใหม่หรือแก้ไขนับจากการส่งออกครั้งก่อน ลองเลือก “ทั้งหมดที่จับคู่แล้ว”"
                              : "ต้องจับคู่รายการยากับรหัสมาตรฐานก่อน จึงจะมีแถวให้ส่งออก"
                          }
                        />
                      </TableMessage>
                    ) : (
                      rows.map((row, index) => (
                        <tr key={row.hospdrugcode}>
                          <td className="cell-num text-slate-500">{index + 1}</td>
                          <td className="cell-code">{row.hospdrugcode}</td>
                          <td>{row.productcat}</td>
                          <td className="cell-code">{row.tmtid}</td>
                          <td className="max-w-64">{row.genericname || <Badge tone="warning">ว่าง</Badge>}</td>
                          <td className="max-w-48 text-slate-600">{row.tradename || "—"}</td>
                          <td className="cell-num">{row.unitprice || "—"}</td>
                          <td>{row.ised || <Badge tone="warning">ว่าง</Badge>}</td>
                          <td className="cell-code text-xxs">{row.ndc24 || "—"}</td>
                          <td>
                            <Badge>{row.updateflag}</Badge>
                          </td>
                          <td className="whitespace-nowrap">{row.dateeffective ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                )}
              </Table>
            </TableScroll>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
