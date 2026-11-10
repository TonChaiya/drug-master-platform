"use client";

import { type FormEvent, useState } from "react";
import { TtmtResultCard, type TtmtResult } from "@/components/ttmt/ttmt-result-card";
import { Alert } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, SearchInput } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";

export function TtmtSearch() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TtmtResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) return setError("กรุณาค้นหาอย่างน้อย 2 ตัวอักษร");
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/mappings/v2/standards?source=TTMT&q=${encodeURIComponent(normalized)}`);
      const payload = (await response.json()) as { ok?: boolean; rows?: TtmtResult[]; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "ค้นหา TTMT ไม่สำเร็จ");
      setRows(payload.rows ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ค้นหา TTMT ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader title="ค้นหามาตรฐาน TTMT" description="TTMT เป็นผลิตภัณฑ์คนละ namespace กับ TMT และไม่มีลำดับชั้น GP/GPU/TP/TPU" />
      <CardBody className="space-y-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void search(event)}>
          <Field label="รหัสหรือชื่อ TTMT" htmlFor="ttmt-hub-query" className="min-w-60 flex-1">
            <SearchInput id="ttmt-hub-query" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={loading}>ค้นหา TTMT</Button>
        </form>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!loading && rows.length === 0 ? (
          <EmptyState compact title="ยังไม่มีผลการค้นหา TTMT" description="ค้นหาด้วยรหัส ชื่อยา ชื่อการค้า ผู้ผลิต หรือเลขทะเบียนยา" />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">{rows.map((row) => <TtmtResultCard key={row.code} result={row} />)}</div>
        )}
      </CardBody>
    </Card>
  );
}
