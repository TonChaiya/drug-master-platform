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

export function TtmtResultCard({ result, children }: { result: TtmtResult; children?: ReactNode }) {
  return (
    <article className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success">TTMT</Badge>
        <span className="cell-code">{result.code}</span>
        <Badge tone={result.active ? "success" : "warning"}>{result.active ? "ใช้งานอยู่" : "ไม่ใช้งาน"}</Badge>
      </div>
      <p className="mt-2 break-words text-xs font-semibold text-ink">{result.fsn ?? result.activeIngredient ?? ""}</p>
      <dl className="mt-2 grid gap-2 text-xxs sm:grid-cols-3">
        <div><dt className="type-caption">ชื่อการค้า</dt><dd>{result.tradeName ?? ""}</dd></div>
        <div><dt className="type-caption">ผู้ผลิต</dt><dd>{result.manufacturer ?? ""}</dd></div>
        <div><dt className="type-caption">เลขทะเบียนยา</dt><dd>{result.registrationNumber ?? ""}</dd></div>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="type-help mr-auto">เวอร์ชันข้อมูล TTMT {result.sourceVersion}</span>
        {children}
      </div>
    </article>
  );
}
