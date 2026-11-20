import type { ReactNode } from "react";
import type { TmtKnownStatus } from "@/modules/tmt/browser";
import { TmtLevelBadge } from "./tmt-level-badge";
import { Badge } from "@/components/ui/badge";

export interface TmtResultSummary {
  level: string;
  tmtId: string;
  name: string;
  activeIngredient?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  tradeName: string | null;
  manufacturer: string | null;
  registrationNumber: string | null;
  registrationConflict: boolean;
  status: TmtKnownStatus;
  mappingEligible: boolean;
  mappingEligibilityReason: string;
}

function statusLabel(status: TmtKnownStatus): string {
  if (status === "active") return "ใช้งานอยู่";
  if (status === "cancelled") return "ยกเลิกแล้ว";
  return "ยังไม่ทราบ";
}

function OptionalValue({ label, value }: { label: string; value: string | null }) {
  return <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs"><span className="type-caption">{label}</span><span className="break-words text-ink">{value ?? ""}</span></div>;
}

function CompactValue({ label, value }: { label: string; value: string | null | undefined }) {
  return value ? <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2"><span className="text-slate-500">{label}</span><span className="break-words text-ink">{value}</span></div> : null;
}

export function TmtResultCard({ result, children, comparison = false, current = false }: { result: TmtResultSummary; children?: ReactNode; comparison?: boolean; current?: boolean }) {
  const decisionName = comparison && result.activeIngredient ? result.activeIngredient : result.name;
  return (
    <article className={`min-w-0 rounded-md border bg-surface ${comparison ? "grid gap-x-4 gap-y-2 px-2.5 py-2.5 lg:grid-cols-[minmax(0,2fr)_minmax(12rem,1.15fr)_minmax(11rem,1fr)] lg:items-center" : "p-3"} ${current ? "border-primary-300 ring-1 ring-primary-100" : "border-border"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5"><TmtLevelBadge level={result.level} /><span className="cell-code">{result.tmtId}</span>{current && !comparison ? <Badge tone="info">รายการปัจจุบัน</Badge> : null}</div>
        <p className={`${comparison ? "mt-1" : "mt-2"} break-words text-xs font-semibold text-ink`}>{decisionName}{comparison && result.strength ? ` · ${result.strength}` : null}</p>
        {comparison && result.activeIngredient && result.name !== result.activeIngredient ? <p className="type-help mt-0.5 break-words">{result.name}</p> : null}
      </div>
      {comparison ? <div className="mt-1 min-w-0 space-y-0.5 text-xxs lg:mt-0"><CompactValue label="รูปแบบ" value={result.dosageForm} /><CompactValue label="ชื่อการค้า" value={result.tradeName} /><CompactValue label="ผู้ผลิต" value={result.manufacturer} />{result.registrationConflict ? <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2"><span className="text-slate-500">ทะเบียน</span><span><Badge tone="warning">เลขทะเบียนมีหลายค่า</Badge></span></div> : <CompactValue label="ทะเบียน" value={result.registrationNumber} />}</div> : <div className="mt-2 space-y-1">
        <OptionalValue label="ชื่อการค้า" value={result.tradeName} />
        <OptionalValue label="ผู้ผลิต" value={result.manufacturer} />
        <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
          <span className="type-caption">เลขทะเบียนยา</span>
          <span className="break-words text-ink">
            {result.registrationConflict ? <Badge tone="warning">เลขทะเบียนมีหลายค่า</Badge> : (result.registrationNumber ?? "")}
          </span>
        </div>
      </div>}
      {comparison ? <div className="flex min-w-0 flex-col items-start justify-center gap-1.5 lg:items-end">
        <div className="flex flex-wrap gap-1.5 lg:justify-end"><Badge tone={result.status === "active" ? "success" : result.status === "cancelled" ? "warning" : "neutral"}>{statusLabel(result.status)}</Badge><Badge tone={result.mappingEligible ? "success" : "warning"}>{result.mappingEligibilityReason}</Badge>{current ? <Badge tone="info">รายการปัจจุบัน</Badge> : null}</div>
        {children ? <div className="flex flex-wrap gap-1.5 lg:justify-end">{children}</div> : null}
      </div> : <>
        <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={result.status === "active" ? "success" : result.status === "cancelled" ? "warning" : "neutral"}>{statusLabel(result.status)}</Badge><Badge tone={result.mappingEligible ? "success" : "warning"}>{result.mappingEligibilityReason}</Badge></div>
        {children ? <div className="mt-2 flex flex-wrap justify-end gap-2">{children}</div> : null}
      </>}
    </article>
  );
}
