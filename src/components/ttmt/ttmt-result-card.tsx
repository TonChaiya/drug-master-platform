import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export interface TtmtResult {
  source: "TTMT";
  code: string;
  level: "product";
  fsn: string | null;
  activeIngredient: string | null;
  tradeName: string | null;
  manufacturer: string | null;
  registrationNumber: string | null;
  active: boolean;
  sourceVersion: string;
}

export function TtmtResultCard({ result, children, comparison = false, current = false }: { result: TtmtResult; children?: ReactNode; comparison?: boolean; current?: boolean }) {
  return (
    <article className={`min-w-0 rounded-md border bg-surface ${comparison ? "grid gap-x-3 gap-y-1.5 px-2.5 py-2 lg:grid-cols-[minmax(14rem,1fr)_minmax(18rem,1.25fr)_auto] lg:items-center" : "p-3"} ${current ? "border-primary-300 ring-1 ring-primary-100" : "border-border"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="success">TTMT</Badge>
          <span className="cell-code">{result.code}</span>
          {!comparison ? <Badge tone={result.active ? "success" : "warning"}>{result.active ? "ใช้งานอยู่" : "ไม่ใช้งาน"}</Badge> : null}
          {current && !comparison ? <Badge tone="info">รายการปัจจุบัน</Badge> : null}
        </div>
        <p className={`${comparison ? "mt-1" : "mt-2"} break-words text-xs font-semibold text-ink`}>{comparison ? (result.activeIngredient ?? result.fsn ?? "") : (result.fsn ?? result.activeIngredient ?? "")}</p>
        {comparison && result.activeIngredient && result.fsn && result.fsn !== result.activeIngredient ? <p className="type-help mt-0.5 break-words">{result.fsn}</p> : null}
      </div>
      <dl className={`${comparison ? "mt-1 flex flex-wrap gap-x-3 gap-y-0.5" : "mt-2 grid gap-2 sm:grid-cols-3"} text-xxs`}>
        <div className="min-w-0"><dt className="type-caption">ชื่อการค้า</dt><dd className="break-words">{result.tradeName ?? ""}</dd></div>
        <div className="min-w-0"><dt className="type-caption">ผู้ผลิต</dt><dd className="break-words">{result.manufacturer ?? ""}</dd></div>
        <div className="min-w-0"><dt className="type-caption">เลขทะเบียนยา</dt><dd className="break-words">{result.registrationNumber ?? ""}</dd></div>
        {comparison ? <div className="min-w-0"><dt className="type-caption">เวอร์ชันข้อมูล</dt><dd className="break-words">{result.sourceVersion}</dd></div> : null}
      </dl>
      <div className={`${comparison ? "gap-1.5 lg:justify-end" : "mt-2 gap-2"} flex min-w-0 flex-wrap items-center`}>
        {comparison ? <Badge tone={result.active ? "success" : "warning"}>{result.active ? "ใช้งานอยู่" : "ไม่ใช้งาน"}</Badge> : <span className="type-help mr-auto">เวอร์ชันข้อมูล TTMT {result.sourceVersion}</span>}
        {current && comparison ? <Badge tone="info">รายการปัจจุบัน</Badge> : null}
        {children}
      </div>
    </article>
  );
}
