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
    <article className={`min-w-0 rounded-md border bg-surface ${comparison ? "px-2.5 py-2" : "p-3"} ${current ? "border-primary-300 ring-1 ring-primary-100" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="success">TTMT</Badge>
        <span className="cell-code">{result.code}</span>
        <Badge tone={result.active ? "success" : "warning"}>{result.active ? "ใช้งานอยู่" : "ไม่ใช้งาน"}</Badge>
        {current ? <Badge tone="info">รายการปัจจุบัน</Badge> : null}
      </div>
      <p className={`${comparison ? "mt-1" : "mt-2"} break-words text-xs font-semibold text-ink`}>{comparison ? (result.activeIngredient ?? result.fsn ?? "") : (result.fsn ?? result.activeIngredient ?? "")}</p>
      {comparison && result.activeIngredient && result.fsn && result.fsn !== result.activeIngredient ? <p className="type-help mt-0.5 break-words">{result.fsn}</p> : null}
      <dl className={`${comparison ? "mt-1 flex flex-wrap gap-x-3 gap-y-0.5" : "mt-2 grid gap-2 sm:grid-cols-3"} text-xxs`}>
        <div className="min-w-0"><dt className="type-caption">ชื่อการค้า</dt><dd className="break-words">{result.tradeName ?? ""}</dd></div>
        <div className="min-w-0"><dt className="type-caption">ผู้ผลิต</dt><dd className="break-words">{result.manufacturer ?? ""}</dd></div>
        <div className="min-w-0"><dt className="type-caption">เลขทะเบียนยา</dt><dd className="break-words">{result.registrationNumber ?? ""}</dd></div>
      </dl>
      <div className={`${comparison ? "mt-1.5 gap-1.5" : "mt-2 gap-2"} flex flex-wrap items-center`}>
        <span className="type-help mr-auto">เวอร์ชันข้อมูล TTMT {result.sourceVersion}</span>
        {children}
      </div>
    </article>
  );
}
